/**
 * RSS ingestion. 100% API-key-free: Google News search RSS, TechCrunch's
 * /feed, the official Hacker News RSS mirror, and Reddit's per-subreddit
 * .rss endpoint. We use a minimal hand-rolled parser instead of pulling in
 * `rss-parser` so the backend keeps its tiny dependency footprint and we
 * avoid an optional native build step on user machines.
 */

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { createHash } from 'node:crypto';
import type { NewsSourceKind } from '@prisma/client';

export interface ParsedFeedItem {
  externalId: string;
  title: string;
  link: string;
  snippet: string | null;
  contentHtml: string | null;
  author: string | null;
  publishedAt: Date | null;
  raw: Record<string, any>;
}

export interface FeedResult {
  source: { kind: NewsSourceKind; name: string; url: string };
  items: ParsedFeedItem[];
}

export interface FeedSourceSpec {
  kind: NewsSourceKind;
  name: string;
  url?: string;
  query?: string | null;
  subreddit?: string | null;
}

const UA =
  'Mozilla/5.0 (compatible; ShipublicBot/1.0; +https://github.com/blessl/Shipublic)';

@Injectable()
export class RssService {
  private readonly logger = new Logger(RssService.name);

  resolveUrl(spec: FeedSourceSpec): string {
    if (spec.url && spec.url.startsWith('http')) return spec.url;
    switch (spec.kind) {
      case 'GOOGLE_NEWS': {
        const q = encodeURIComponent(spec.query?.trim() || 'AI');
        return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
      }
      case 'TECHCRUNCH':
        return 'https://techcrunch.com/feed/';
      case 'HACKER_NEWS':
        return 'https://hnrss.org/frontpage';
      case 'REDDIT': {
        const sr = (spec.subreddit || '').replace(/^r\//i, '').trim();
        if (!sr) throw new Error('subreddit required for REDDIT source');
        return `https://www.reddit.com/r/${encodeURIComponent(sr)}/.rss`;
      }
      case 'CUSTOM':
        if (!spec.url) throw new Error('url required for CUSTOM source');
        return spec.url;
    }
  }

  async fetch(spec: FeedSourceSpec): Promise<FeedResult> {
    const url = this.resolveUrl(spec);
    const { data } = await axios.get<string>(url, {
      timeout: 15_000,
      responseType: 'text',
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, text/xml, */*' },
      // Some feeds (Reddit) gzip aggressively; axios handles it.
      decompress: true,
      // Cap payload at 4 MB to defend against runaway responses.
      maxContentLength: 4 * 1024 * 1024,
    });
    const items = this.parseFeed(String(data));
    return { source: { kind: spec.kind, name: spec.name, url }, items };
  }

  /**
   * Tiny RSS 2.0 + Atom parser. Handles both `<item>` (RSS) and `<entry>`
   * (Atom). Extracts a stable id (guid > link > title hash) and decodes the
   * common HTML entities found in feed titles/snippets.
   */
  parseFeed(xml: string): ParsedFeedItem[] {
    const items: ParsedFeedItem[] = [];
    const blocks = this.splitBlocks(xml);
    for (const block of blocks) {
      const isAtom = /^<entry[\s>]/i.test(block);
      const title = this.cleanText(this.firstTag(block, 'title'));
      let link = this.firstTag(block, 'link');
      if (isAtom && /<link[^>]*href=/i.test(block)) {
        const m = block.match(/<link[^>]*href=["']([^"']+)["']/i);
        if (m) link = m[1];
      }
      link = (link || '').trim();
      const guid =
        this.firstTag(block, 'guid') ||
        this.firstTag(block, 'id') ||
        link ||
        title;
      const description =
        this.firstTag(block, 'description') ||
        this.firstTag(block, 'summary') ||
        this.firstTag(block, 'content:encoded') ||
        this.firstTag(block, 'content');
      const author =
        this.firstTag(block, 'author') ||
        this.firstTag(block, 'dc:creator') ||
        null;
      const pub =
        this.firstTag(block, 'pubDate') ||
        this.firstTag(block, 'published') ||
        this.firstTag(block, 'updated');
      const publishedAt = pub ? this.parseDate(pub) : null;

      if (!title || !link) continue;

      const externalId = createHash('sha256').update(guid).digest('hex').slice(0, 32);
      items.push({
        externalId,
        title: title.slice(0, 500),
        link: link.slice(0, 1000),
        snippet: description ? this.stripHtml(description).slice(0, 800) : null,
        contentHtml: description ? description.slice(0, 8000) : null,
        author: author ? this.cleanText(author).slice(0, 200) : null,
        publishedAt,
        raw: { guid },
      });
    }
    return items;
  }

  private splitBlocks(xml: string): string[] {
    const out: string[] = [];
    const re = /<(item|entry)[\s>][\s\S]*?<\/\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      out.push(m[0]);
      if (out.length >= 200) break; // safety cap
    }
    return out;
  }

  private firstTag(block: string, tag: string): string {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i');
    const m = block.match(re);
    if (!m) return '';
    return this.unwrapCdata(m[1]).trim();
  }

  private unwrapCdata(s: string): string {
    const m = s.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    return m ? m[1] : s;
  }

  private cleanText(s: string): string {
    return this.decodeEntities(s).replace(/\s+/g, ' ').trim();
  }

  private stripHtml(s: string): string {
    return this.decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  }

  private decodeEntities(s: string): string {
    return s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  }

  private parseDate(s: string): Date | null {
    const t = Date.parse(s);
    return Number.isFinite(t) ? new Date(t) : null;
  }
}
