'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Github, Lock, Play, Sun, Moon, User as UserIcon } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { API_BASE } from '@/lib/api';
import {
  DEMO_PASSWORD,
  DEMO_USERNAME,
  enableDemo,
  validateDemoCredentials,
} from '@/lib/demo';
import styles from './login.module.css';

function LoginInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { theme, toggle } = useTheme();
  const [username, setUsername] = useState(DEMO_USERNAME);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [autoCountdown, setAutoCountdown] = useState<number | null>(null);

  const submit = (uname: string, pwd: string) => {
    setSubmitting(true);
    setError(null);
    if (!validateDemoCredentials(uname, pwd)) {
      setError('Invalid credentials. Try the pre-filled demo account.');
      setSubmitting(false);
      return;
    }
    enableDemo();
    router.replace('/dashboard');
  };

  useEffect(() => {
    if (search?.get('demo') !== '1') return;
    setAutoCountdown(8);
    const tick = setInterval(() => {
      setAutoCountdown((c) => {
        if (c === null) return c;
        if (c <= 1) {
          clearInterval(tick);
          submit(DEMO_USERNAME, DEMO_PASSWORD);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit(username, password);
  };

  return (
    <main className={styles.wrap}>
      <button
        onClick={toggle}
        className={styles.themeBtn}
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <Link href="/" className={styles.brand}>Shipublic</Link>

      <div className={styles.card}>
        <div className={styles.demoBadge}>
          <Play size={12} /> Free Demo
        </div>
        <h1 className={styles.title}>Sign in to Shipublic</h1>
        <p className={styles.sub}>
          Demo credentials are pre-filled. Use them to explore the full
          dashboard with seeded mock data. No backend required.
        </p>

        <form onSubmit={onSubmit} className={styles.form}>
          <label className={styles.label}>
            <span>Username</span>
            <div className={styles.inputWrap}>
              <UserIcon size={14} className={styles.inputIcon} />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                spellCheck={false}
              />
            </div>
          </label>

          <label className={styles.label}>
            <span>Password</span>
            <div className={styles.inputWrap}>
              <Lock size={14} className={styles.inputIcon} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          </label>

          {error && <div className={styles.error}>{error}</div>}

          <button type="submit" className={styles.cta} disabled={submitting}>
            {submitting ? 'Entering demo' : autoCountdown !== null && autoCountdown > 0
              ? `Auto Login in ${autoCountdown}`
              : 'Enter Demo Workspace'}
            <ArrowRight size={16} />
          </button>

          <div className={styles.divider}><span>or</span></div>

          <a href={`${API_BASE}/api/auth/github`} className={styles.ghost}>
            <Github size={16} /> Continue with GitHub
          </a>
        </form>

        <div className={styles.foot}>
          <div>
            <strong>Demo username:</strong> <code>{DEMO_USERNAME}</code>
          </div>
          <div>
            <strong>Demo password:</strong> <code>{DEMO_PASSWORD}</code>
          </div>
          <div className={styles.note}>
            Demo runs entirely in your browser. All actions are read and view
            only - destructive changes do not persist.
          </div>
        </div>
      </div>

      <Link href="/" className={styles.backLink}>← Back to landing</Link>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', opacity: 0.7 }}>Loading sign in</div>}>
      <LoginInner />
    </Suspense>
  );
}
