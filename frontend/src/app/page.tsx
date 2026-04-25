'use client';

import { Github, ArrowRight, Sun, Moon } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { API_BASE } from '@/lib/api';
import styles from './page.module.css';

export default function Landing() {
  const { theme, toggle } = useTheme();
  return (
    <main className={styles.wrap}>
      <button
        onClick={toggle}
        style={{ position: 'absolute', top: 18, right: 18 }}
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <div className={styles.brand}>Shipublic</div>
      <h1 className={styles.title}>
        Turn your commits into <span className={styles.titleAccent}>build in public</span> posts.
      </h1>
      <p className={styles.tagline}>
        Local first. Your git diffs analyzed by Ollama, polished into engaging
        updates for Twitter and LinkedIn. No cloud. No API costs.
      </p>
      <div className={styles.actions}>
        <a className={styles.cta} href={`${API_BASE}/api/auth/github`}>
          <Github size={18} /> Continue with GitHub <ArrowRight size={16} />
        </a>
        <a className={styles.ghost} href="https://github.com" target="_blank" rel="noreferrer">
          Learn more
        </a>
      </div>
      <div className={styles.foot}>Open source. AGPL v3.0.</div>
    </main>
  );
}
