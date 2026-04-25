'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, FolderGit2, Sparkles, GitCommit } from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from '@/components/Card';
import { ContributionGraph } from '@/components/ContributionGraph';
import type { Post, Project } from '@/lib/types';
import styles from './overview.module.css';

export default function OverviewPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [primaryProjectId, setPrimaryProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [pj, ps] = await Promise.all([api.projects.list(), api.posts.list()]);
        setProjects(pj as Project[]);
        setPosts(ps as Post[]);
        const first = (pj as Project[])[0];
        if (first) setPrimaryProjectId(first.id);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className={styles.muted}>Loading overview</div>;

  const drafts = posts.filter((p) => p.status === 'DRAFT').length;
  const scheduled = posts.filter((p) => p.status === 'SCHEDULED').length;
  const published = posts.filter((p) => p.status === 'PUBLISHED').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className={styles.statRow}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Projects</div>
          <div className={styles.statValue}>
            <FolderGit2 size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />
            {projects.length}
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Drafts</div>
          <div className={styles.statValue}>
            <Sparkles size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />
            <span className={styles.heroNum}>{drafts}</span>
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Scheduled</div>
          <div className={styles.statValue}>{scheduled}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Published</div>
          <div className={styles.statValue}>{published}</div>
        </div>
      </div>

      <Card
        title="Recent posts"
        action={
          <Link href="/dashboard/posts">
            <button>View all</button>
          </Link>
        }
      >
        {posts.length === 0 && <div className={styles.muted}>No posts yet. Generate one from any project.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {posts.slice(0, 6).map((p) => (
            <Link key={p.id} href={`/dashboard/posts/${p.id}`}>
              <div style={{
                border: '1px solid rgba(var(--fgRgb), 0.10)',
                padding: '10px 12px',
                borderRadius: 10,
              }}>
                <div style={{ fontSize: 12, opacity: 0.6, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{p.platform.toLowerCase()} · {p.status.toLowerCase()}</span>
                  <span>{new Date(p.createdAt).toLocaleString()}</span>
                </div>
                <div style={{ marginTop: 4, color: 'var(--fg)' }}>
                  {p.content?.slice(0, 140) || (p.metadata?.generating ? 'Generating...' : 'Empty draft')}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </Card>

      <Card title="Your GitHub activity">
        {primaryProjectId ? (
          <ContributionGraph projectId={primaryProjectId} />
        ) : (
          <div className={styles.muted}>Add a project to see contributions.</div>
        )}
      </Card>

      <Card title="Projects">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {projects.map((p) => (
            <Link key={p.id} href={`/dashboard/projects/${p.id}`}>
              <div style={{
                border: '1px solid rgba(var(--fgRgb), 0.10)',
                padding: 14,
                borderRadius: 12,
                color: 'var(--fg)',
              }}>
                <div style={{ fontWeight: 700 }}>{p.fullName}</div>
                <div className={styles.muted} style={{ fontSize: 13, marginTop: 4 }}>
                  {p.description || 'No description'}
                </div>
                <div className={styles.row} style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                  <Activity size={12} /> {p.autoSync ? 'auto sync on' : 'manual'}
                  <span style={{ marginLeft: 'auto' }}>
                    <GitCommit size={12} /> {p.defaultBranch}
                  </span>
                </div>
              </div>
            </Link>
          ))}
          {projects.length === 0 && <div className={styles.muted}>No projects yet.</div>}
        </div>
      </Card>
    </div>
  );
}
