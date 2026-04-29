'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import type { Post, Project } from '@/lib/types';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'rgba(var(--fgRgb), 0.6)',
  SCHEDULED: 'var(--hero)',
  PUBLISHED: 'var(--hero)',
  FAILED: 'var(--hero)',
};

export default function PostsPage() {
  const { data: posts = [] } = useApi<Post[]>(
    'posts:list',
    () => api.posts.list() as Promise<Post[]>,
  );
  const { data: projects = [] } = useApi<Project[]>(
    'projects:list',
    () => api.projects.list() as Promise<Project[]>,
  );

  const [filter, setFilter] = useState('');
  // Defer the filter so a long render of the list doesn't block keystrokes.
  const deferredFilter = useDeferredValue(filter);

  // O(1) project lookup instead of an array scan per post.
  const projectMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.fullName);
    return m;
  }, [projects]);

  const filtered = useMemo(() => {
    if (!deferredFilter) return posts;
    const q = deferredFilter.toLowerCase();
    return posts.filter((p) =>
      p.content.toLowerCase().includes(q) ||
      ((p.projectId && projectMap.get(p.projectId)) || '').toLowerCase().includes(q),
    );
  }, [posts, deferredFilter, projectMap]);

  return (
    <Card
      title="All posts"
      action={
        <input
          placeholder="Search posts"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: 240 }}
        />
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map((p) => (
          <Link key={p.id} href={`/dashboard/posts/${p.id}`} prefetch={false}>
            <div style={{
              border: '1px solid rgba(var(--fgRgb), 0.10)',
              padding: '12px 14px',
              borderRadius: 10,
              color: 'var(--fg)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.6 }}>
                <span>
                  {(p.projectId && projectMap.get(p.projectId)) ||
                    (p.kind === 'NEWS' ? 'AI News Gen' : '')} · {p.platform.toLowerCase()} ·{' '}
                  <span style={{ color: STATUS_COLORS[p.status] }}>{p.status.toLowerCase()}</span>
                </span>
                <span>{new Date(p.createdAt).toLocaleString()}</span>
              </div>
              <div style={{ marginTop: 6 }}>
                {p.content?.slice(0, 200) || (p.metadata?.generating ? 'Generating...' : 'Empty draft')}
              </div>
            </div>
          </Link>
        ))}
        {filtered.length === 0 && <div style={{ opacity: 0.6 }}>No posts.</div>}
      </div>
    </Card>
  );
}
