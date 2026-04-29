/**
 * NewsService — owns the lifecycle of user-defined RSS sources, fetched
 * NewsItems, and the AI News Gen post pipeline. Mirrors the shape of
 * CommitsService + PostsService so the frontend can reuse familiar patterns.
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type {
  NewsItemStatus,
  NewsSourceKind,
  PostPlatform,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RssService, FeedSourceSpec } from './rss.service';
import { NEWS_QUEUE } from './news.module';

export interface CreateSourceInput {
  kind: NewsSourceKind;
  name?: string;
  url?: string;
  query?: string | null;
  subreddit?: string | null;
  enabled?: boolean;
}

export interface UpdateSourceInput {
  name?: string;
  url?: string;
  query?: string | null;
  subreddit?: string | null;
  enabled?: boolean;
}

export interface RefreshInput {
  sourceIds?: string[];
}

export interface GenerateNewsPostInput {
  newsItemIds: string[];
  platform?: PostPlatform;
  tone?: string;
  /** Override the auto-prompted background. When set, ComfyUI is skipped. */
  assetId?: string | null;
}

const DEFAULT_SOURCES: CreateSourceInput[] = [
  { kind: 'GOOGLE_NEWS', name: 'Google News — AI', query: 'AI' },
  { kind: 'TECHCRUNCH', name: 'TechCrunch' },
  { kind: 'HACKER_NEWS', name: 'Hacker News — Front Page' },
  { kind: 'REDDIT', name: 'Reddit — r/Artificial', subreddit: 'Artificial' },
];

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rss: RssService,
    @InjectQueue(NEWS_QUEUE) private readonly queue: Queue,
  ) {}

  // -------------------------------------------------------------------------
  // Sources
  // -------------------------------------------------------------------------

  async listSources(userId: string) {
    const existing = await this.prisma.newsSource.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    if (existing.length) return existing;
    // Lazily seed the four free defaults the first time a user opens the
    // module so the page is useful with zero configuration.
    for (const def of DEFAULT_SOURCES) {
      try {
        await this.createSource(userId, def);
      } catch (e: any) {
        this.logger.warn(`failed to seed default source ${def.name}: ${e?.message}`);
      }
    }
    return this.prisma.newsSource.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createSource(userId: string, input: CreateSourceInput) {
    if (!input?.kind) throw new BadRequestException('kind required');
    const spec: FeedSourceSpec = {
      kind: input.kind,
      name: (input.name || this.defaultNameFor(input)).slice(0, 120),
      url: input.url || undefined,
      query: input.query ?? null,
      subreddit: input.subreddit ?? null,
    };
    let url: string;
    try {
      url = this.rss.resolveUrl(spec);
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'invalid source spec');
    }
    return this.prisma.newsSource.create({
      data: {
        userId,
        kind: spec.kind,
        name: spec.name,
        url,
        query: spec.query ?? null,
        subreddit: spec.subreddit ?? null,
        enabled: input.enabled ?? true,
      },
    });
  }

  async updateSource(userId: string, id: string, patch: UpdateSourceInput) {
    const existing = await this.prisma.newsSource.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('source');
    const spec: FeedSourceSpec = {
      kind: existing.kind,
      name: patch.name ?? existing.name,
      url: patch.url ?? existing.url,
      query: patch.query !== undefined ? patch.query : existing.query,
      subreddit:
        patch.subreddit !== undefined ? patch.subreddit : existing.subreddit,
    };
    let url = existing.url;
    try {
      url = this.rss.resolveUrl(spec);
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'invalid source');
    }
    return this.prisma.newsSource.update({
      where: { id },
      data: {
        name: spec.name,
        url,
        query: spec.query ?? null,
        subreddit: spec.subreddit ?? null,
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      },
    });
  }

  async deleteSource(userId: string, id: string) {
    const existing = await this.prisma.newsSource.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('source');
    await this.prisma.newsSource.delete({ where: { id } });
    return { ok: true };
  }

  private defaultNameFor(input: CreateSourceInput): string {
    switch (input.kind) {
      case 'GOOGLE_NEWS':
        return `Google News — ${input.query || 'AI'}`;
      case 'TECHCRUNCH':
        return 'TechCrunch';
      case 'HACKER_NEWS':
        return 'Hacker News';
      case 'REDDIT':
        return `Reddit — r/${(input.subreddit || '').replace(/^r\//i, '')}`;
      case 'CUSTOM':
        return 'Custom RSS';
    }
  }

  // -------------------------------------------------------------------------
  // Items
  // -------------------------------------------------------------------------

  async listItems(
    userId: string,
    opts: { sourceId?: string; status?: NewsItemStatus; take?: number } = {},
  ) {
    const take = Math.min(Math.max(Number(opts.take || 100), 1), 300);
    return this.prisma.newsItem.findMany({
      where: {
        userId,
        ...(opts.sourceId ? { sourceId: opts.sourceId } : {}),
        ...(opts.status ? { status: opts.status } : {}),
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take,
    });
  }

  async getItem(userId: string, id: string) {
    const item = await this.prisma.newsItem.findFirst({
      where: { id, userId },
    });
    if (!item) throw new NotFoundException('news item');
    return item;
  }

  async dismissItem(userId: string, id: string) {
    await this.getItem(userId, id);
    return this.prisma.newsItem.update({
      where: { id },
      data: { status: 'DISMISSED' },
    });
  }

  /**
   * Fetch every (or selected) source for the user, dedupe by externalId,
   * and persist new items. Returns a summary of inserts and errors so the UI
   * can show a useful toast.
   */
  async refresh(
    userId: string,
    input: RefreshInput = {},
  ): Promise<{ fetched: number; inserted: number; errors: Array<{ source: string; message: string }> }> {
    const sources = await this.prisma.newsSource.findMany({
      where: {
        userId,
        enabled: true,
        ...(input.sourceIds?.length ? { id: { in: input.sourceIds } } : {}),
      },
    });
    if (!sources.length) return { fetched: 0, inserted: 0, errors: [] };

    let fetched = 0;
    let inserted = 0;
    const errors: Array<{ source: string; message: string }> = [];

    for (const src of sources) {
      try {
        const result = await this.rss.fetch({
          kind: src.kind,
          name: src.name,
          url: src.url,
          query: src.query,
          subreddit: src.subreddit,
        });
        fetched += result.items.length;
        for (const it of result.items) {
          try {
            await this.prisma.newsItem.create({
              data: {
                userId,
                sourceId: src.id,
                externalId: it.externalId,
                kind: src.kind,
                sourceName: src.name,
                title: it.title,
                link: it.link,
                snippet: it.snippet,
                contentHtml: it.contentHtml,
                author: it.author,
                publishedAt: it.publishedAt,
                raw: it.raw as any,
              },
            });
            inserted++;
          } catch (e: any) {
            // unique violation on (userId, externalId) is the normal dedup path.
            if (!String(e?.code || '').includes('P2002')) {
              this.logger.warn(`insert failed for ${src.name}: ${e?.message}`);
            }
          }
        }
        await this.prisma.newsSource.update({
          where: { id: src.id },
          data: { lastFetchedAt: new Date() },
        });
      } catch (e: any) {
        const msg = e?.message || 'fetch failed';
        this.logger.warn(`source ${src.name} failed: ${msg}`);
        errors.push({ source: src.name, message: msg });
      }
    }
    return { fetched, inserted, errors };
  }

  // -------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------

  async enqueueGeneration(userId: string, input: GenerateNewsPostInput) {
    const ids = (input.newsItemIds || []).filter(Boolean);
    if (!ids.length) throw new BadRequestException('newsItemIds required');

    const items = await this.prisma.newsItem.findMany({
      where: { userId, id: { in: ids } },
    });
    if (!items.length) throw new NotFoundException('no matching news items');

    const platform: PostPlatform = input.platform ?? 'GENERIC';
    const headline = items[0].title;
    const post = await this.prisma.post.create({
      data: {
        userId,
        kind: 'NEWS',
        title: headline.slice(0, 200),
        content: '',
        platform,
        status: 'DRAFT',
        newsItemIds: items.map((i) => i.id),
        metadata: {
          tone: input.tone ?? 'sharp solo-developer voice, no hype',
          generating: true,
          source: 'ai-news',
          sources: items.map((i) => ({ id: i.id, title: i.title, link: i.link, sourceName: i.sourceName })),
        },
      },
    });

    await this.queue.add(
      'generate-news',
      {
        postId: post.id,
        userId,
        newsItemIds: items.map((i) => i.id),
        platform,
        tone: input.tone ?? 'sharp solo-developer voice, no hype',
        assetId: input.assetId ?? null,
      },
      { removeOnComplete: 100, removeOnFail: 50, attempts: 1 },
    );

    return post;
  }
}
