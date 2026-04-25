'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  FolderGit2,
  CalendarDays,
  Sparkles,
  LogOut,
  Sun,
  Moon,
  Plus,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import type { Project, User } from '@/lib/types';
import styles from './layout.module.css';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { theme, toggle } = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [u, p] = await Promise.all([api.me(), api.projects.list()]);
        if (!mounted) return;
        setUser(u as User);
        setProjects(p as Project[]);
      } catch {
        router.replace('/');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [router]);

  const isActive = (p: string) => path === p || path?.startsWith(p + '/');

  const logout = async () => {
    try { await api.logout(); } catch {}
    router.replace('/');
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div style={{ opacity: 0.7 }}>Loading workspace</div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.side}>
        <div className={styles.brand}>
          <span className={styles.brandDot} /> Shipublic
        </div>

        <div>
          <div className={styles.navTitle}>Workspace</div>
          <Link className={`${styles.navItem} ${isActive('/dashboard') && path === '/dashboard' ? styles.navActive : ''}`} href="/dashboard">
            <LayoutDashboard size={16} /> Overview
          </Link>
          <Link className={`${styles.navItem} ${isActive('/dashboard/projects') ? styles.navActive : ''}`} href="/dashboard/projects">
            <FolderGit2 size={16} /> Projects
          </Link>
          <Link className={`${styles.navItem} ${isActive('/dashboard/calendar') ? styles.navActive : ''}`} href="/dashboard/calendar">
            <CalendarDays size={16} /> Calendar
          </Link>
          <Link className={`${styles.navItem} ${isActive('/dashboard/posts') ? styles.navActive : ''}`} href="/dashboard/posts">
            <Sparkles size={16} /> Posts
          </Link>
        </div>

        <div>
          <div className={styles.navTitle}>My projects</div>
          <div className={styles.projectList}>
            {projects.map((p) => (
              <Link
                key={p.id}
                className={`${styles.navItem} ${path?.includes(p.id) ? styles.navActive : ''}`}
                href={`/dashboard/projects/${p.id}`}
                title={p.fullName}
              >
                <FolderGit2 size={14} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </span>
              </Link>
            ))}
            <Link className={styles.navItem} href="/dashboard/projects">
              <Plus size={14} /> Add project
            </Link>
          </div>
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button className={styles.navItem} onClick={toggle} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button className={styles.navItem} onClick={logout}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div style={{ fontWeight: 700, letterSpacing: 0.2 }}>Dashboard</div>
          <div className={styles.userBox}>
            {user?.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.avatar} src={user.avatarUrl} alt={user.username} />
            )}
            <span className={styles.username}>{user?.name || user?.username}</span>
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
