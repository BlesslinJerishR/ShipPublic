'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  FolderGit2,
  CalendarDays,
  Sparkles,
  ImageIcon,
  Newspaper,
  LogOut,
  Sun,
  Moon,
  Plus,
  Play,
  X,
  Settings as SettingsIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useTheme } from '@/lib/theme';
import { disableDemo, isDemoMode, onDemoNotice } from '@/lib/demo';
import type { Project, User } from '@/lib/types';
import styles from './layout.module.css';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { theme, toggle } = useTheme();
  const [demo, setDemo] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { data: user, error: meError, isLoading: meLoading } = useApi<User>(
    'auth:me',
    () => api.me() as Promise<User>,
  );
  const { data: projects = [], isLoading: pLoading } = useApi<Project[]>(
    'projects:list',
    () => api.projects.list() as Promise<Project[]>,
  );

  // If /me errored, the session is invalid → bounce to login.
  useEffect(() => {
    if (meError) router.replace('/login');
  }, [meError, router]);

  useEffect(() => {
    setDemo(isDemoMode());
    const off = onDemoNotice((msg) => {
      setToast(msg);
      window.clearTimeout((window as any).__demoToast);
      (window as any).__demoToast = window.setTimeout(() => setToast(null), 3500);
    });
    return () => { off(); };
  }, []);

  const isActive = useCallback(
    (p: string) => path === p || (path?.startsWith(p + '/') ?? false),
    [path],
  );

  const logout = useCallback(async () => {
    if (isDemoMode()) {
      disableDemo();
      router.replace('/');
      return;
    }
    try { await api.logout(); } catch {}
    router.replace('/');
  }, [router]);

  const exitDemo = useCallback(() => {
    disableDemo();
    router.replace('/');
  }, [router]);

  const loading = (meLoading || pLoading) && !user;
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

        <div className={styles.section}>
          <div className={styles.navTitle}>Workspace</div>
          <Link prefetch={false} className={`${styles.navItem} ${isActive('/dashboard') && path === '/dashboard' ? styles.navActive : ''}`} href="/dashboard">
            <LayoutDashboard size={16} /> Overview
          </Link>
          <Link prefetch={false} className={`${styles.navItem} ${isActive('/dashboard/projects') ? styles.navActive : ''}`} href="/dashboard/projects">
            <FolderGit2 size={16} /> Projects
          </Link>
          <Link prefetch={false} className={`${styles.navItem} ${isActive('/dashboard/calendar') ? styles.navActive : ''}`} href="/dashboard/calendar">
            <CalendarDays size={16} /> Calendar
          </Link>
          <Link prefetch={false} className={`${styles.navItem} ${isActive('/dashboard/posts') ? styles.navActive : ''}`} href="/dashboard/posts">
            <Sparkles size={16} /> Posts
          </Link>
          <Link prefetch={false} className={`${styles.navItem} ${isActive('/dashboard/news') ? styles.navActive : ''}`} href="/dashboard/news">
            <Newspaper size={16} /> AI News Gen
          </Link>
          <Link prefetch={false} className={`${styles.navItem} ${isActive('/dashboard/gallery') ? styles.navActive : ''}`} href="/dashboard/gallery">
            <ImageIcon size={16} /> Gallery
          </Link>
          <Link prefetch={false} className={`${styles.navItem} ${isActive('/dashboard/settings') ? styles.navActive : ''}`} href="/dashboard/settings">
            <SettingsIcon size={16} /> Settings
          </Link>
        </div>

        <div className={styles.section}>
          <div className={styles.navTitle}>My projects</div>
          <Link
            prefetch={false}
            className={`${styles.navItem} ${styles.addProjectBtn}`}
            href="/dashboard/projects?add=1"
          >
            <Plus size={14} /> Add project
          </Link>
          <div className={styles.projectList}>
            {projects.map((p) => (
              <Link
                prefetch={false}
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
            {projects.length === 0 && (
              <div className={styles.projectsEmpty}>No projects yet.</div>
            )}
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
        {demo && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '8px 24px',
              background: 'rgba(255, 0, 79, 0.08)',
              borderBottom: '1px solid rgba(255, 0, 79, 0.25)',
              color: 'var(--hero)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Play size={13} />
              Demo workspace &middot; read &amp; view only with seeded mock data &middot; refresh resets all changes
            </span>
            <button
              onClick={exitDemo}
              style={{
                background: 'transparent',
                border: '1px solid rgba(255, 0, 79, 0.45)',
                color: 'var(--hero)',
                borderRadius: 8,
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <X size={12} /> Exit demo
            </button>
          </div>
        )}
        <header className={styles.topbar}>
          <div style={{ fontWeight: 700, letterSpacing: 0.2 }}>Dashboard</div>
          <div className={styles.userBox}>
            {user?.avatarUrl && (
              <Image
                className={styles.avatar}
                src={user.avatarUrl}
                alt={user.username}
                width={28}
                height={28}
                priority={false}
                unoptimized
              />
            )}
            <span className={styles.username}>{user?.name || user?.username}</span>
          </div>
        </header>
        <main className={styles.content}>{children}</main>
        {toast && (
          <div
            role="status"
            style={{
              position: 'fixed',
              bottom: 24,
              right: 24,
              maxWidth: 360,
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(20, 21, 24, 0.96)',
              color: '#fff',
              border: '1px solid rgba(255, 0, 79, 0.35)',
              boxShadow: '0 12px 40px rgba(0, 0, 0, 0.35)',
              fontSize: 13,
              lineHeight: 1.5,
              zIndex: 100,
            }}
          >
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
