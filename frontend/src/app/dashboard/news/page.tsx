'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Newspaper,
  RefreshCw,
  Sparkles,
  Check,
  ExternalLink,
  Trash2,
  Plus,
  X,
} from 'lucide-react';

import { Card } from '@/components/Card';
import { Select } from '@/components/Select';
import { api } from '@/lib/api';
import type {
  NewsItem,
  NewsRefreshResult,
  NewsSource,
  NewsSourceKind,
  Post,
} from '@/lib/types';
import styles from './news.module.css';

const KIND_LABEL: Record<NewsSourceKind, string> = {
  GOOGLE_NEWS: 'Google News',
  TECHCRUNCH: 'TechCrunch',
  HACKER_NEWS: 'Hacker News',
  REDDIT: 'Reddit',
  CUSTOM: 'Custom',
};

interface ItemRowProps {
  item: NewsItem;
  selected: boolean;
  onToggle: (id: string) => void;
  onDismiss: (id: string) => void;
}

const ItemRow = memo(function ItemRow({ item, selected, onToggle, onDismiss }: ItemRowProps) {
  const when = useMemo(
    () =>
      item.publishedAt
        ? new Date(item.publishedAt).toLocaleString()
        : new Date(item.createdAt).toLocaleString(),
    [item.publishedAt, item.createdAt],
  );
  const handleClick = useCallback(() => onToggle(item.id), [item.id, onToggle]);
  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDismiss(item.id);
    },
    [item.id, onDismiss],
  );
  const handleOpen = useCallback(
    (e: React.MouseEvent) => e.stopPropagation(),
    [],
  );

  const cls = `${styles.itemRow} ${item.status === 'DISMISSED' ? styles.dismissed : ''} ${
    item.status === 'USED' ? styles.used : ''
  }`;
  return (
    <div className={cls} onClick={handleClick}>
      <span className={`${styles.checkbox} ${selected ? styles.checkboxOn : ''}`}>
        {selected && <Check size={12} color="#fff" />}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className={styles.itemTitle}>{item.title}</div>
        {item.snippet && <div className={styles.itemSnippet}>{item.snippet}</div>}
        <div className={styles.itemMeta}>
          <span className={styles.itemSourceTag}>{KIND_LABEL[item.kind]}</span>
          <span>{item.sourceName}</span>
          <span>·</span>
          <span>{when}</span>
          {item.status !== 'NEW' && <span>· {item.status.toLowerCase()}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.iconBtn}
          onClick={handleOpen}
          title="Open original"
        >
          <ExternalLink size={14} />
        </a>
        <button
          className={styles.iconBtn}
          onClick={handleDismiss}
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
});

export default function NewsPage() {
  const router = useRouter();

  const [sources, setSources] = useState<NewsSource[]>([]);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [enabledSources, setEnabledSources] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [platform, setPlatform] = useState<'TWITTER' | 'LINKEDIN' | 'GENERIC'>('GENERIC');
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [errors, setErrors] = useState<NewsRefreshResult['errors']>([]);

  // Add-source form
  const [addKind, setAddKind] = useState<NewsSourceKind>('REDDIT');
  const [addQuery, setAddQuery] = useState('');
  const [addSubreddit, setAddSubreddit] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addName, setAddName] = useState('');

  const loadAll = useCallback(async () => {
    const [s, it] = await Promise.all([
      api.news.sources.list() as Promise<NewsSource[]>,
      api.news.items.list({ take: 200 }) as Promise<NewsItem[]>,
    ]);
    setSources(s);
    setEnabledSources((prev) => {
      // Keep prior selection when sources reload; default-include all enabled.
      if (prev.size) return prev;
      return new Set(s.filter((x) => x.enabled).map((x) => x.id));
    });
    setItems(it);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAll().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadAll]);

  const toggleSource = useCallback((id: string) => {
    setEnabledSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshNote(null);
    setErrors([]);
    try {
      const ids = Array.from(enabledSources);
      const res = (await api.news.refresh(ids)) as NewsRefreshResult;
      setRefreshNote(
        `Fetched ${res.fetched} item${res.fetched === 1 ? '' : 's'} · ${res.inserted} new`,
      );
      setErrors(res.errors || []);
      const it = (await api.news.items.list({ take: 200 })) as NewsItem[];
      setItems(it);
    } catch (e: any) {
      setRefreshNote(e?.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [enabledSources]);

  const toggleItem = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const dismissItem = useCallback(async (id: string) => {
    try {
      await api.news.items.dismiss(id);
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, status: 'DISMISSED' } : it)),
      );
      setSelected((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch {
      /* no-op */
    }
  }, []);

  const clearSel = useCallback(() => setSelected(new Set()), []);

  const generate = useCallback(async () => {
    if (!selected.size) {
      alert('Select at least one news item');
      return;
    }
    setGenerating(true);
    try {
      const post = (await api.news.generate({
        newsItemIds: Array.from(selected),
        platform,
      })) as Post;
      router.push(`/dashboard/posts/${post.id}`);
    } catch (e: any) {
      alert(e?.message || 'Failed to start generation');
    } finally {
      setGenerating(false);
    }
  }, [selected, platform, router]);

  const addSource = useCallback(async () => {
    try {
      const body: any = { kind: addKind };
      if (addName.trim()) body.name = addName.trim();
      if (addKind === 'GOOGLE_NEWS' && addQuery.trim()) body.query = addQuery.trim();
      if (addKind === 'REDDIT') {
        if (!addSubreddit.trim()) {
          alert('Subreddit name required (e.g. MachineLearning)');
          return;
        }
        body.subreddit = addSubreddit.trim().replace(/^r\//i, '');
      }
      if (addKind === 'CUSTOM') {
        if (!addUrl.trim()) {
          alert('Feed URL required for custom source');
          return;
        }
        body.url = addUrl.trim();
      }
      const created = (await api.news.sources.create(body)) as NewsSource;
      setSources((prev) => [...prev, created]);
      setEnabledSources((prev) => new Set(prev).add(created.id));
      setAddQuery('');
      setAddSubreddit('');
      setAddUrl('');
      setAddName('');
    } catch (e: any) {
      alert(e?.message || 'Failed to add source');
    }
  }, [addKind, addQuery, addSubreddit, addUrl, addName]);

  const deleteSource = useCallback(async (id: string) => {
    if (!confirm('Remove this source?')) return;
    try {
      await api.news.sources.remove(id);
      setSources((prev) => prev.filter((s) => s.id !== id));
      setEnabledSources((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e: any) {
      alert(e?.message || 'Failed');
    }
  }, []);

  const platformOptions = useMemo(
    () => [
      { value: 'GENERIC', label: 'Generic' },
      { value: 'TWITTER', label: 'Twitter' },
      { value: 'LINKEDIN', label: 'LinkedIn' },
    ],
    [],
  );

  const kindOptions = useMemo(
    () => [
      { value: 'GOOGLE_NEWS', label: 'Google News (search)' },
      { value: 'TECHCRUNCH', label: 'TechCrunch' },
      { value: 'HACKER_NEWS', label: 'Hacker News' },
      { value: 'REDDIT', label: 'Reddit (r/...)' },
      { value: 'CUSTOM', label: 'Custom RSS URL' },
    ],
    [],
  );

  const visibleItems = useMemo(
    () => items.filter((i) => i.status !== 'DISMISSED'),
    [items],
  );

  if (loading) return <div style={{ opacity: 0.6 }}>Loading AI news</div>;

  return (
    <div>
      <div className={styles.head}>
        <div className={styles.title}>
          <div className={styles.pageName}>
            <Newspaper size={22} /> AI News Gen
          </div>
          <div className={styles.pageMeta}>
            Hybrid pipeline: free RSS → Ollama summary → social-ready post + image.
            ComfyUI background optional.
          </div>
        </div>
        <div className={styles.toolbar}>
          <button
            onClick={refresh}
            disabled={refreshing || enabledSources.size === 0}
            title="Pull latest from selected sources"
          >
            <RefreshCw size={14} /> {refreshing ? 'Fetching' : 'Refresh feeds'}
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card
            title={`News items (${visibleItems.length})`}
            action={
              <div className={styles.toolbar}>
                <button onClick={clearSel} disabled={!selected.size}>
                  Clear ({selected.size})
                </button>
              </div>
            }
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                maxHeight: 640,
                overflowY: 'auto',
              }}
            >
              {visibleItems.map((it) => (
                <ItemRow
                  key={it.id}
                  item={it}
                  selected={selected.has(it.id)}
                  onToggle={toggleItem}
                  onDismiss={dismissItem}
                />
              ))}
              {visibleItems.length === 0 && (
                <div className={styles.empty}>
                  No news items yet. Pick at least one source above and click
                  "Refresh feeds".
                </div>
              )}
            </div>
            {refreshNote && (
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                {refreshNote}
              </div>
            )}
            {errors.length > 0 && (
              <div className={styles.errorList}>
                {errors.map((e) => (
                  <div key={e.source}>
                    {e.source}: {e.message}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Sources">
            <div className={styles.sourceCheckGroup}>
              {sources.map((s) => (
                <label
                  key={s.id}
                  className={styles.sourceCheckRow}
                >
                  <input
                    type="checkbox"
                    checked={enabledSources.has(s.id)}
                    onChange={() => toggleSource(s.id)}
                  />
                  <span style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{s.name}</div>
                    <div style={{ fontSize: 11, opacity: 0.55 }}>
                      {KIND_LABEL[s.kind]}
                      {s.lastFetchedAt
                        ? ` · last ${new Date(s.lastFetchedAt).toLocaleString()}`
                        : ''}
                    </div>
                  </span>
                  <button
                    className={styles.iconBtn}
                    onClick={(e) => {
                      e.preventDefault();
                      deleteSource(s.id);
                    }}
                    title="Remove source"
                  >
                    <Trash2 size={13} />
                  </button>
                </label>
              ))}
              {sources.length === 0 && (
                <div className={styles.empty}>
                  No sources yet. Add one below.
                </div>
              )}
            </div>
          </Card>

          <Card title="Add source">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className={styles.field}>
                <span className={styles.label}>Kind</span>
                <Select
                  value={addKind}
                  onChange={(v) => setAddKind(v as NewsSourceKind)}
                  options={kindOptions}
                  fullWidth
                />
              </div>
              {addKind === 'GOOGLE_NEWS' && (
                <div className={styles.field}>
                  <span className={styles.label}>Search query</span>
                  <input
                    placeholder="e.g. AI, LLM, Stable Diffusion"
                    value={addQuery}
                    onChange={(e) => setAddQuery(e.target.value)}
                  />
                </div>
              )}
              {addKind === 'REDDIT' && (
                <div className={styles.field}>
                  <span className={styles.label}>Subreddit</span>
                  <input
                    placeholder="MachineLearning"
                    value={addSubreddit}
                    onChange={(e) => setAddSubreddit(e.target.value)}
                  />
                </div>
              )}
              {addKind === 'CUSTOM' && (
                <div className={styles.field}>
                  <span className={styles.label}>RSS URL</span>
                  <input
                    placeholder="https://example.com/feed"
                    value={addUrl}
                    onChange={(e) => setAddUrl(e.target.value)}
                  />
                </div>
              )}
              <div className={styles.field}>
                <span className={styles.label}>Display name (optional)</span>
                <input
                  placeholder="Auto if blank"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                />
              </div>
              <button onClick={addSource}>
                <Plus size={14} /> Add source
              </button>
            </div>
          </Card>

          <Card title="Generate post">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className={styles.field}>
                <span className={styles.label}>Platform</span>
                <Select
                  value={platform}
                  onChange={(v) => setPlatform(v as any)}
                  options={platformOptions}
                  fullWidth
                />
              </div>
              <button
                className="heroBtn"
                disabled={generating || !selected.size}
                onClick={generate}
              >
                <Sparkles size={14} /> Generate from selection ({selected.size})
              </button>
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
                Pipeline: coder model brief → chat model post → ComfyUI background
                (if configured) → image.
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
