/**
 * Demo Mode — frontend-only mock API + in-memory data store.
 *
 * When demo mode is active, every call from `apiFetch()` is short-circuited
 * to `handleDemoRequest()` which serves and mutates an in-memory dataset.
 *
 * Hard rules:
 *  - No real network calls go out.
 *  - Mutations are kept in-memory only and reset on hard refresh.
 *  - Destructive operations (delete, sync from GitHub) are gracefully
 *    no-op'd with a friendly notice instead of failing, so every button
 *    in the UI continues to work.
 */

import type {
  Commit,
  ContributionCalendar,
  GalleryAsset,
  GalleryImage,
  GalleryRenderSpec,
  GallerySettings,
  Post,
  Project,
  RepoSummary,
  User,
} from './types';
import { appendSignature, DEFAULT_SIGNATURE, getSettings } from './settings';
import { RATIOS } from './gallery-ratios';
import { normaliseSpec, renderToDataUrl, uhdScale, type PartialRenderSpec } from './gallery-render';

export const DEMO_USERNAME = 'blessl.in';
export const DEMO_PASSWORD = 'blessl.in';
const DEMO_FLAG_KEY = 'shipublic.demo';

export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(DEMO_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function enableDemo() {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(DEMO_FLAG_KEY, '1'); } catch {}
  resetDemoStore();
}

export function disableDemo() {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(DEMO_FLAG_KEY); } catch {}
  store = null;
}

export function validateDemoCredentials(username: string, password: string) {
  return username.trim() === DEMO_USERNAME && password === DEMO_PASSWORD;
}

// ---------------------------------------------------------------------------
// Notice channel — UI surfaces (banner / toast) can subscribe to friendly
// "demo mode: this action is read-only" messages.
// ---------------------------------------------------------------------------

type NoticeListener = (msg: string) => void;
const listeners = new Set<NoticeListener>();
export function onDemoNotice(fn: NoticeListener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(msg: string) {
  for (const fn of listeners) {
    try { fn(msg); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

interface DemoStore {
  user: User;
  projects: Project[];
  available: RepoSummary[];
  commitsByProject: Record<string, Commit[]>;
  posts: Post[];
  galleryAssets: GalleryAsset[];
  galleryImages: GalleryImage[];
  gallerySettings: GallerySettings;
}

let store: DemoStore | null = null;

function nowIso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
}

function rand(seed: number) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function buildCommits(projectId: string, repoFull: string, count = 240): Commit[] {
  const authors = [
    { name: 'Blesslin Jerish R', email: 'hello@blessl.in' },
    { name: 'Demo Bot', email: 'demo@blessl.in' },
  ];
  const messages = [
    'feat(auth): add github oauth flow',
    'fix(posts): handle empty diff payloads gracefully',
    'chore(prisma): bump schema for post scheduling',
    'feat(ollama): hybrid coder + chat pipeline',
    'refactor(commits): cache diff fetch by sha',
    'feat(dashboard): contribution heatmap component',
    'fix(webhook): verify github signature header',
    'feat(posts): linkedin & twitter platform variants',
    'chore(ci): add docker compose smoke test',
    'feat(projects): auto sync toggle per repo',
    'fix(queue): retry failed bullmq jobs with backoff',
    'feat(calendar): posts calendar with drag scheduling',
    'docs(readme): self host setup walkthrough',
    'perf(diff): stream large diffs to coder model',
    'feat(api): rate limit /posts/generate per user',
  ];
  const out: Commit[] = [];
  // Spread commits across roughly 3 years to make the year tabs meaningful.
  const spanDays = 3 * 365;
  for (let i = 0; i < count; i++) {
    const r = rand(i + projectId.length);
    const adds = Math.floor(r * 240) + 5;
    const dels = Math.floor(rand(i + 99) * 80);
    const files = Math.floor(rand(i + 11) * 9) + 1;
    const sha = (Math.floor(rand(i + 7) * 0xffffffff)).toString(16).padStart(8, '0') +
      (Math.floor(rand(i + 31) * 0xffffffff)).toString(16).padStart(8, '0') +
      (Math.floor(rand(i + 53) * 0xffffffff)).toString(16).padStart(8, '0');
    const author = authors[i % authors.length];
    // Bias slightly toward more recent days so the current year is denser.
    const skew = Math.pow(rand(i * 7 + 13), 1.6);
    const daysAgo = Math.floor(skew * spanDays);
    out.push({
      id: `${projectId}-c-${i}`,
      projectId,
      sha,
      message: messages[i % messages.length],
      authorName: author.name,
      authorEmail: author.email,
      authoredAt: nowIso(-daysAgo),
      url: `https://github.com/${repoFull}/commit/${sha}`,
      additions: adds,
      deletions: dels,
      filesChanged: files,
      diffPreview:
        `diff --git a/src/file${i % 5}.ts b/src/file${i % 5}.ts\n` +
        `+ // ${messages[i % messages.length]}\n` +
        `+ export async function handler() { return 'shipped'; }\n` +
        `- // legacy stub`,
      summary: null,
    });
  }
  // Sort newest first to mirror real GitHub commit listings.
  out.sort((a, b) => (a.authoredAt < b.authoredAt ? 1 : -1));
  return out;
}

function buildProject(id: string, owner: string, name: string, opts: Partial<Project> = {}): Project {
  return {
    id,
    userId: 'demo-user-1',
    githubRepoId: `${1000000 + Math.abs(hash(id))}`,
    owner,
    name,
    fullName: `${owner}/${name}`,
    defaultBranch: 'main',
    description: opts.description ?? null,
    private: opts.private ?? false,
    autoSync: opts.autoSync ?? false,
    webhookId: null,
    lastSyncedAt: nowIso(-1),
    createdAt: nowIso(-30),
    updatedAt: nowIso(-1),
    ...opts,
  };
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0;
  return h;
}

function buildPosts(projects: Project[]): Post[] {
  const sample = [
    {
      platform: 'LINKEDIN' as const,
      status: 'PUBLISHED' as const,
      title: 'Shipped GitHub OAuth today',
      content:
        'Shipped GitHub OAuth on Shipublic today.\n\nOne tap sign in, secure session tokens, and a webhook that watches every push.\n\nLocal first, AGPL 3.0, runs on your own box. The build in public engine I always wanted.',
      summary:
        '- New GitHubAuthService with OAuth code exchange\n- JWT issued via cookie session\n- Adds /api/auth/me and /api/auth/logout endpoints\n- Webhook scaffolding for push events',
      offset: -2,
    },
    {
      platform: 'TWITTER' as const,
      status: 'SCHEDULED' as const,
      title: 'Hybrid Ollama pipeline live',
      content:
        'Hybrid Ollama pipeline live on @shipublic.\n\nqwen2.5 coder reads the diff. qwen3 polishes the post.\n\nTwo models. One pipeline. Zero cloud calls.',
      summary:
        '- OllamaService with coder + chat model selection\n- Streaming diff summaries into structured JSON\n- BullMQ job queue handles long generations',
      offset: 1,
    },
    {
      platform: 'GENERIC' as const,
      status: 'DRAFT' as const,
      title: 'Posts calendar prototype',
      content:
        'Day 14 of building Shipublic.\n\nAdded a posts calendar that shows every draft, scheduled, and published update across your projects.',
      summary:
        '- New PostsCalendar component\n- Month grid with status pills\n- Click to open the post editor',
      offset: 0,
    },
    {
      platform: 'LINKEDIN' as const,
      status: 'DRAFT' as const,
      title: 'Auto sync on push',
      content:
        'Auto sync per project is now live on Shipublic.\n\nFlip a switch and every git push generates a fresh build in public draft for you to review.',
      summary:
        '- Per project autoSync toggle\n- Webhook installs on enable\n- BullMQ enqueues a generation job per push',
      offset: -5,
    },
    {
      platform: 'TWITTER' as const,
      status: 'PUBLISHED' as const,
      title: 'Backfill old commits',
      content:
        'You can now backfill old commits on Shipublic.\n\nPick any range, regenerate posts for shipped work you forgot to talk about. Six months of silent shipping turned into six months of stories.',
      summary:
        '- Range based commit fetcher\n- Re-runs hybrid pipeline on selected shas',
      offset: -8,
    },
  ];
  const out: Post[] = [];
  let idx = 0;
  for (const project of projects) {
    for (const s of sample) {
      const created = nowIso(s.offset - idx);
      out.push({
        id: `${project.id}-post-${idx}`,
        userId: 'demo-user-1',
        projectId: project.id,
        title: s.title,
        content: appendSignature(s.content, DEFAULT_SIGNATURE),
        summary: s.summary,
        platform: s.platform,
        status: s.status,
        scheduledFor: s.status === 'SCHEDULED' ? nowIso(s.offset) : null,
        publishedAt: s.status === 'PUBLISHED' ? nowIso(s.offset) : null,
        commitShas: [],
        rangeFrom: nowIso(s.offset - 7),
        rangeTo: nowIso(s.offset),
        metadata: { generated: true, model: 'qwen2.5-coder + qwen3' },
        createdAt: created,
        updatedAt: created,
      });
      idx++;
    }
  }
  return out;
}

function resetDemoStore() {
  const projects: Project[] = [
    buildProject('demo-proj-shipublic', 'BlesslinJerishR', 'Shipublic', {
      description: 'Open source local first build in public automation. Turn git commits into engaging stories.',
      autoSync: true,
    }),
    buildProject('demo-proj-ollama-kit', 'BlesslinJerishR', 'ollama-kit', {
      description: 'Tiny TypeScript SDK for talking to a local Ollama runtime.',
    }),
    buildProject('demo-proj-bullmq-lab', 'BlesslinJerishR', 'bullmq-lab', {
      description: 'Production BullMQ patterns. Retries, backoff, scheduled jobs, dashboards.',
      private: true,
    }),
  ];
  const commitsByProject: Record<string, Commit[]> = {};
  for (const p of projects) commitsByProject[p.id] = buildCommits(p.id, p.fullName);

  const available: RepoSummary[] = [
    ...projects.map((p) => ({
      id: Number(p.githubRepoId),
      name: p.name,
      fullName: p.fullName,
      owner: p.owner,
      description: p.description,
      defaultBranch: p.defaultBranch,
      private: p.private,
      pushedAt: p.lastSyncedAt,
      stars: 12 + Math.abs(hash(p.id)) % 200,
      language: 'TypeScript',
    })),
    {
      id: 9000001,
      name: 'next-saas-starter',
      fullName: 'BlesslinJerishR/next-saas-starter',
      owner: 'BlesslinJerishR',
      description: 'Opinionated Next.js + Prisma + Postgres SaaS starter.',
      defaultBranch: 'main',
      private: false,
      pushedAt: nowIso(-3),
      stars: 86,
      language: 'TypeScript',
    },
    {
      id: 9000002,
      name: 'nest-prisma-template',
      fullName: 'BlesslinJerishR/nest-prisma-template',
      owner: 'BlesslinJerishR',
      description: 'NestJS 11 with Fastify, Prisma, BullMQ, and Helmet pre-wired.',
      defaultBranch: 'main',
      private: false,
      pushedAt: nowIso(-12),
      stars: 41,
      language: 'TypeScript',
    },
    {
      id: 9000003,
      name: 'blessl.in',
      fullName: 'BlesslinJerishR/blessl.in',
      owner: 'BlesslinJerishR',
      description: 'Personal site and writing.',
      defaultBranch: 'main',
      private: false,
      pushedAt: nowIso(-20),
      stars: 7,
      language: 'MDX',
    },
  ];

  store = {
    user: {
      id: 'demo-user-1',
      username: DEMO_USERNAME,
      name: 'Demo Account',
      email: 'demo@blessl.in',
      avatarUrl: 'https://avatars.githubusercontent.com/u/9919?v=4',
    },
    projects,
    available,
    commitsByProject,
    posts: buildPosts(projects),
    galleryAssets: buildDemoAssets(),
    galleryImages: [],
    gallerySettings: buildDemoSettings(),
  };
  // Hydrate canvas-rendered preview images for the seeded posts so the
  // gallery and post detail pages have something to show on first load.
  hydrateDemoGalleryImages();
}

// ---------------------------------------------------------------------------
// Demo gallery seed
// ---------------------------------------------------------------------------

const DEMO_DEFAULT_BG_URL = '/demo/blessl-bg.png';
const DEMO_DEFAULT_ASSET_ID = 'demo-asset-default';

function buildDemoAssets(): GalleryAsset[] {
  return [
    {
      id: DEMO_DEFAULT_ASSET_ID,
      userId: 'demo-user-1',
      name: 'blessl.in default',
      mimeType: 'image/png',
      width: 2160,
      height: 2700,
      sizeBytes: 174456,
      filename: 'blessl-bg.png',
      isDefault: true,
      createdAt: nowIso(-365),
      updatedAt: nowIso(-365),
      url: DEMO_DEFAULT_BG_URL,
    },
  ];
}

function buildDemoSettings(): GallerySettings {
  return {
    id: 'demo-gs-1',
    userId: 'demo-user-1',
    defaultRatio: 'INSTAGRAM_PORTRAIT',
    marginTopPct: 14,
    marginBottomPct: 16,
    marginLeftPct: 8,
    marginRightPct: 8,
    fontFamily: 'Inter',
    fontSize: 48,
    fontColor: '#FFFFFF',
    textAlign: 'left',
    verticalAlign: 'center',
    bgFit: 'cover',
    bgFillColor: '#1D1E21',
    defaultAssetId: DEMO_DEFAULT_ASSET_ID,
    autoGenerate: true,
    createdAt: nowIso(-365),
    updatedAt: nowIso(-1),
  };
}

function bgUrlForAsset(s: DemoStore, assetId: string | null | undefined): string | null {
  if (!assetId) {
    return s.gallerySettings.defaultAssetId
      ? bgUrlForAsset(s, s.gallerySettings.defaultAssetId)
      : DEMO_DEFAULT_BG_URL;
  }
  const a = s.galleryAssets.find((x) => x.id === assetId);
  return a?.url || DEMO_DEFAULT_BG_URL;
}

function hydrateDemoGalleryImages() {
  // Lazy: defer to next tick so SSR-safe + so initial render is not blocked.
  if (typeof window === 'undefined' || !store) return;
  const s = store;
  // Render an image for the three most-recent posts. Failures are silent in
  // demo so a missing default BG simply yields no preview.
  setTimeout(async () => {
    const targets = s.posts.slice(0, 3);
    for (const post of targets) {
      try {
        await ensureDemoImageForPost(s, post);
        // Trigger a re-render by notifying any subscribed UI via the cache
        // bust hook. Demo callers re-fetch on every navigation, so a
        // notification here is a UX nicety, not a requirement.
      } catch {
        /* ignore */
      }
    }
  }, 50);
}

async function ensureDemoImageForPost(s: DemoStore, post: Post): Promise<GalleryImage> {
  const existing = s.galleryImages.find((g) => g.postId === post.id);
  if (existing) return existing;
  const ratio = (() => {
    if (post.platform === 'TWITTER') return 'TWITTER_LANDSCAPE';
    if (post.platform === 'LINKEDIN') return 'LINKEDIN_LANDSCAPE';
    return s.gallerySettings.defaultRatio;
  })();
  const partial: PartialRenderSpec = {
    ratio,
    marginTopPct: s.gallerySettings.marginTopPct,
    marginBottomPct: s.gallerySettings.marginBottomPct,
    marginLeftPct: s.gallerySettings.marginLeftPct,
    marginRightPct: s.gallerySettings.marginRightPct,
    fontFamily: s.gallerySettings.fontFamily,
    fontSize: s.gallerySettings.fontSize,
    fontColor: s.gallerySettings.fontColor,
    textAlign: s.gallerySettings.textAlign,
    verticalAlign: s.gallerySettings.verticalAlign,
    bgFit: s.gallerySettings.bgFit,
    bgFillColor: s.gallerySettings.bgFillColor,
    content: post.content || '',
  };
  const spec = normaliseSpec(partial);
  // Render the demo asset at >= UHD so that the post-page Download (which
  // streams `image.dataUrl` straight to the user in demo mode) is full-res.
  const scale = uhdScale(spec);
  let dataUrl = '';
  try {
    dataUrl = await renderToDataUrl(spec, DEMO_DEFAULT_BG_URL, { scale });
  } catch {
    /* ignore — image stays empty in demo */
  }
  const img: GalleryImage = {
    id: `demo-img-${post.id}`,
    userId: 'demo-user-1',
    postId: post.id,
    assetId: DEMO_DEFAULT_ASSET_ID,
    filename: `${post.id}.png`,
    mimeType: 'image/png',
    width: spec.width * scale,
    height: spec.height * scale,
    sizeBytes: dataUrl.length,
    spec: spec as GalleryRenderSpec,
    status: 'READY',
    createdAt: nowIso(0),
    updatedAt: nowIso(0),
    dataUrl,
  };
  s.galleryImages.unshift(img);
  return img;
}

function getStore(): DemoStore {
  if (!store) resetDemoStore();
  return store!;
}

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------

function parseUrl(path: string) {
  const [p, q = ''] = path.split('?');
  const params = new URLSearchParams(q);
  return { path: p, params };
}

function cloneDemoValue<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value;
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

async function delay<T>(value: T, ms = 120): Promise<T> {
  return new Promise((res) => setTimeout(() => res(cloneDemoValue(value)), ms));
}

function readBody<T = any>(init: RequestInit): T | null {
  if (!init?.body) return null;
  try { return JSON.parse(init.body as string) as T; } catch { return null; }
}

function buildContributions(commits: Commit[], from?: string | null, to?: string | null): ContributionCalendar {
  const buckets = new Map<string, number>();
  for (const c of commits) {
    const key = c.authoredAt.substring(0, 10);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  const today = new Date();
  let end = to ? new Date(to) : today;
  if (end > today) end = today;
  let start: Date;
  if (from) {
    start = new Date(from);
  } else {
    start = new Date(end);
    start.setDate(end.getDate() - (52 * 7 - 1));
  }
  // Sunday-align grid start.
  while (start.getUTCDay() !== 0) start.setUTCDate(start.getUTCDate() - 1);

  const weeks: ContributionCalendar['weeks'] = [];
  const cur = new Date(start);
  let total = 0;
  let safety = 0;
  while (cur <= end && safety < 60) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const iso = cur.toISOString().substring(0, 10);
      const count = buckets.get(iso) || 0;
      total += count;
      days.push({
        date: iso,
        contributionCount: count,
        color:
          count === 0 ? 'rgba(255,255,255,0.05)' :
          count < 2 ? 'rgba(255,0,79,0.25)' :
          count < 4 ? 'rgba(255,0,79,0.5)' :
          count < 7 ? 'rgba(255,0,79,0.75)' : 'rgba(255,0,79,1)',
      });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    weeks.push({ contributionDays: days });
    safety++;
  }
  return { totalContributions: total, weeks };
}

export async function handleDemoRequest(rawPath: string, init: RequestInit = {}): Promise<any> {
  const method = (init.method || 'GET').toUpperCase();
  // Strip API base if present
  const noBase = rawPath.replace(/^https?:\/\/[^/]+/, '');
  const { path, params } = parseUrl(noBase);
  const s = getStore();

  // ---- Auth ----
  if (path === '/api/auth/me' && method === 'GET') return delay(s.user);
  if (path === '/api/auth/logout') {
    disableDemo();
    return delay({ ok: true });
  }

  // ---- Projects ----
  if (path === '/api/projects' && method === 'GET') return delay(s.projects);
  if (path === '/api/projects/available' && method === 'GET') return delay(s.available);
  if (path === '/api/projects' && method === 'POST') {
    const body = readBody<{ githubRepoId: number }>(init);
    const repo = s.available.find((r) => r.id === Number(body?.githubRepoId));
    if (!repo) return delay({ message: 'Repo not found in demo' }, 80);
    if (s.projects.some((p) => p.githubRepoId === String(repo.id))) {
      notify('Demo: this repository is already linked.');
      return delay(s.projects.find((p) => p.githubRepoId === String(repo.id))!);
    }
    const proj = buildProject(`demo-proj-${repo.id}`, repo.owner, repo.name, {
      description: repo.description,
      private: repo.private,
    });
    proj.githubRepoId = String(repo.id);
    s.projects.push(proj);
    s.commitsByProject[proj.id] = buildCommits(proj.id, proj.fullName, 24);
    notify('Demo: project linked locally. Changes are not persisted.');
    return delay(proj);
  }

  const projMatch = path.match(/^\/api\/projects\/([^/]+)$/);
  if (projMatch) {
    const id = projMatch[1];
    const idx = s.projects.findIndex((p) => p.id === id);
    if (idx < 0) return delay({ message: 'not found' });
    if (method === 'GET') return delay(s.projects[idx]);
    if (method === 'DELETE') {
      notify('Demo: delete is disabled. The project will reappear on refresh.');
      s.projects.splice(idx, 1);
      return delay({ ok: true });
    }
  }

  const autoSyncMatch = path.match(/^\/api\/projects\/([^/]+)\/auto-sync$/);
  if (autoSyncMatch && method === 'PATCH') {
    const id = autoSyncMatch[1];
    const proj = s.projects.find((p) => p.id === id);
    if (!proj) return delay({ message: 'not found' });
    const body = readBody<{ enabled: boolean }>(init);
    proj.autoSync = !!body?.enabled;
    proj.updatedAt = nowIso();
    notify(`Demo: auto sync ${proj.autoSync ? 'on' : 'off'} (local only).`);
    return delay(proj);
  }

  const contribMatch = path.match(/^\/api\/projects\/([^/]+)\/contributions$/);
  if (contribMatch && method === 'GET') {
    const id = contribMatch[1];
    const commits = s.commitsByProject[id] || [];
    return delay(buildContributions(commits, params.get('from'), params.get('to')));
  }

  // ---- Commits ----
  const commitsListMatch = path.match(/^\/api\/projects\/([^/]+)\/commits$/);
  if (commitsListMatch && method === 'GET') {
    const id = commitsListMatch[1];
    const from = params.get('from');
    const to = params.get('to');
    let list = s.commitsByProject[id] || [];
    if (from) list = list.filter((c) => c.authoredAt >= from);
    if (to) list = list.filter((c) => c.authoredAt <= to);
    const take = Number(params.get('take') || 100);
    return delay(list.slice(0, take));
  }

  const commitsSyncMatch = path.match(/^\/api\/projects\/([^/]+)\/commits\/sync$/);
  if (commitsSyncMatch && method === 'POST') {
    notify('Demo: GitHub sync is disabled. Showing the seeded commit history.');
    const id = commitsSyncMatch[1];
    const proj = s.projects.find((p) => p.id === id);
    if (proj) proj.lastSyncedAt = nowIso();
    return delay({ count: (s.commitsByProject[id] || []).length });
  }

  const commitsAggMatch = path.match(/^\/api\/projects\/([^/]+)\/commits\/aggregates$/);
  if (commitsAggMatch && method === 'GET') {
    const id = commitsAggMatch[1];
    const buckets = new Map<string, number>();
    for (const c of s.commitsByProject[id] || []) {
      const k = c.authoredAt.substring(0, 10);
      buckets.set(k, (buckets.get(k) || 0) + 1);
    }
    return delay(Array.from(buckets.entries()).map(([date, count]) => ({ date, count })));
  }

  const commitDetailMatch = path.match(/^\/api\/projects\/([^/]+)\/commits\/([^/]+)$/);
  if (commitDetailMatch && method === 'GET') {
    const [, projId, sha] = commitDetailMatch;
    const c = (s.commitsByProject[projId] || []).find((x) => x.sha.startsWith(sha));
    if (!c) return delay({ message: 'not found' });
    return delay(c);
  }

  // ---- Posts ----
  if (path === '/api/posts' && method === 'GET') {
    const projectId = params.get('projectId');
    const list = projectId ? s.posts.filter((p) => p.projectId === projectId) : s.posts;
    return delay([...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  if (path === '/api/posts/generate' && method === 'POST') {
    const body = readBody<any>(init);
    const projId = body?.projectId;
    const proj = s.projects.find((p) => p.id === projId);
    if (!proj) return delay({ message: 'project not found' }, 80);
    const id = `${projId}-post-gen-${Date.now()}`;
    const platform = (body?.platform || 'GENERIC') as Post['platform'];
    const shas: string[] = body?.commitShas || [];
    const settings = getSettings();
    const baseContent =
      `Just shipped on ${proj.name}.\n\n` +
      `${shas.length ? `Reviewed ${shas.length} commit${shas.length > 1 ? 's' : ''} with the hybrid Ollama pipeline.` : 'Range based generation across the latest activity.'}\n\n` +
      `Highlights:\n• Cleaner diff handling\n• Faster post generation\n• Better story style voice\n\nBuilt locally. Zero cloud cost.`;
    const post: Post = {
      id,
      userId: 'demo-user-1',
      projectId: projId,
      title: 'Generated draft (demo)',
      content: settings.signatureEnabled ? appendSignature(baseContent, settings.signature) : baseContent,
      summary:
        '- Coder model summarized the diffs into structured changes\n- Chat model rewrote the summary for ' + platform.toLowerCase() + '\n- Demo data only — no real Ollama call was made',
      platform,
      status: 'DRAFT',
      scheduledFor: null,
      publishedAt: null,
      commitShas: shas,
      rangeFrom: body?.rangeFrom || null,
      rangeTo: body?.rangeTo || null,
      metadata: { generated: true, demo: true, signatureApplied: settings.signatureEnabled },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    s.posts.unshift(post);
    notify('Demo: post generated locally. Refresh resets the demo workspace.');
    return delay(post);
  }

  const postMatch = path.match(/^\/api\/posts\/([^/]+)$/);
  if (postMatch) {
    const id = postMatch[1];
    const idx = s.posts.findIndex((p) => p.id === id);
    if (idx < 0) return delay({ message: 'not found' });
    if (method === 'GET') return delay(s.posts[idx]);
    if (method === 'PATCH') {
      const body = readBody<Partial<Post>>(init) || {};
      s.posts[idx] = { ...s.posts[idx], ...body, updatedAt: nowIso() };
      notify('Demo: changes saved to the local workspace only.');
      return delay(s.posts[idx]);
    }
    if (method === 'DELETE') {
      notify('Demo: delete is disabled. The post will reappear on refresh.');
      s.posts.splice(idx, 1);
      return delay({ ok: true });
    }
  }

  // ---- Gallery ----
  if (path === '/api/gallery/ratios' && method === 'GET') {
    return delay(RATIOS);
  }
  if (path === '/api/gallery/settings' && method === 'GET') {
    return delay(s.gallerySettings);
  }
  if (path === '/api/gallery/settings' && method === 'PUT') {
    const body = readBody<Partial<GallerySettings>>(init) || {};
    s.gallerySettings = {
      ...s.gallerySettings,
      ...body,
      updatedAt: nowIso(),
    };
    notify('Demo: gallery settings updated locally.');
    return delay(s.gallerySettings);
  }
  if (path === '/api/gallery/assets' && method === 'GET') {
    return delay(s.galleryAssets);
  }
  if (path === '/api/gallery/assets' && method === 'POST') {
    const body = readBody<{ name?: string; mimeType?: string; base64?: string }>(init) || {};
    const raw = String(body.base64 || '').replace(/^data:[^;]+;base64,/, '');
    const mime = body.mimeType || 'image/png';
    if (!raw) {
      notify('Demo: upload missing image bytes.');
      return delay({ message: 'no bytes' }, 80);
    }
    // Approximate size from base64 length to keep the demo dependency free.
    const sizeBytes = Math.floor(raw.length * 0.75);
    const id = `demo-asset-${Date.now()}`;
    const asset: GalleryAsset = {
      id,
      userId: 'demo-user-1',
      name: body.name || 'background',
      mimeType: mime,
      width: 1200,
      height: 1500,
      sizeBytes,
      filename: `${id}.png`,
      isDefault: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      url: `data:${mime};base64,${raw}`,
    };
    s.galleryAssets.unshift(asset);
    if (!s.gallerySettings.defaultAssetId) {
      s.gallerySettings = {
        ...s.gallerySettings,
        defaultAssetId: id,
        updatedAt: nowIso(),
      };
    }
    notify('Demo: background uploaded locally. Refresh resets the demo workspace.');
    return delay(asset);
  }

  const assetMatch = path.match(/^\/api\/gallery\/assets\/([^/]+)$/);
  if (assetMatch && method === 'DELETE') {
    const id = assetMatch[1];
    const idx = s.galleryAssets.findIndex((a) => a.id === id);
    if (idx >= 0) {
      if (s.galleryAssets[idx].isDefault) {
        notify('Demo: the bundled default cannot be deleted.');
        return delay({ message: 'cannot delete bundled default' }, 80);
      }
      s.galleryAssets.splice(idx, 1);
      if (s.gallerySettings.defaultAssetId === id) {
        s.gallerySettings = {
          ...s.gallerySettings,
          defaultAssetId: DEMO_DEFAULT_ASSET_ID,
          updatedAt: nowIso(),
        };
      }
    }
    notify('Demo: background removed (local only).');
    return delay({ ok: true });
  }

  if (path === '/api/gallery/images' && method === 'GET') {
    const postId = params.get('postId');
    let list = s.galleryImages;
    if (postId) list = list.filter((g) => g.postId === postId);
    return delay([...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  if (path === '/api/gallery/generate' && method === 'POST') {
    const body = readBody<{ postId: string } & Partial<GalleryRenderSpec> & { assetId?: string }>(init) || ({} as any);
    const post = s.posts.find((p) => p.id === body.postId);
    if (!post) {
      return delay({ message: 'post not found' }, 80);
    }
    const assetId = body.assetId || s.gallerySettings.defaultAssetId || DEMO_DEFAULT_ASSET_ID;
    const partial: PartialRenderSpec = {
      ratio: body.ratio || s.gallerySettings.defaultRatio,
      marginTopPct: body.marginTopPct ?? s.gallerySettings.marginTopPct,
      marginBottomPct: body.marginBottomPct ?? s.gallerySettings.marginBottomPct,
      marginLeftPct: body.marginLeftPct ?? s.gallerySettings.marginLeftPct,
      marginRightPct: body.marginRightPct ?? s.gallerySettings.marginRightPct,
      fontFamily: body.fontFamily || s.gallerySettings.fontFamily,
      fontSize: body.fontSize ?? s.gallerySettings.fontSize,
      fontColor: body.fontColor || s.gallerySettings.fontColor,
      textAlign: body.textAlign || s.gallerySettings.textAlign,
      verticalAlign: body.verticalAlign || s.gallerySettings.verticalAlign,
      bgFit: body.bgFit || s.gallerySettings.bgFit,
      bgFillColor: body.bgFillColor || s.gallerySettings.bgFillColor,
      content: body.content ?? post.content,
      offsetX: body.offsetX,
      offsetY: body.offsetY,
    };
    const spec = normaliseSpec(partial);
    const scale = uhdScale(spec);
    let dataUrl = '';
    try {
      dataUrl = await renderToDataUrl(spec, bgUrlForAsset(s, assetId), { scale });
    } catch {
      /* ignore */
    }
    const id = `demo-img-${Date.now()}`;
    const img: GalleryImage = {
      id,
      userId: 'demo-user-1',
      postId: post.id,
      assetId,
      filename: `${id}.png`,
      mimeType: 'image/png',
      width: spec.width * scale,
      height: spec.height * scale,
      sizeBytes: dataUrl.length,
      spec,
      status: 'READY',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      dataUrl,
    };
    // Replace the latest image for this post so the editor doesn't pile up
    // intermediate renders during slider drags.
    s.galleryImages = [img, ...s.galleryImages.filter((g) => g.postId !== post.id)];
    notify('Demo: image rendered locally with the canvas renderer.');
    return delay(img);
  }

  const imgMatch = path.match(/^\/api\/gallery\/images\/([^/]+)$/);
  if (imgMatch) {
    const id = imgMatch[1];
    const idx = s.galleryImages.findIndex((g) => g.id === id);
    if (idx < 0) return delay({ message: 'not found' }, 80);
    if (method === 'GET') return delay(s.galleryImages[idx]);
    if (method === 'PATCH') {
      const body = readBody<Partial<GalleryRenderSpec> & { assetId?: string | null }>(init) || {};
      const prior = s.galleryImages[idx];
      const merged: PartialRenderSpec = { ...prior.spec, ...body } as any;
      const spec = normaliseSpec(merged);
      const assetId = body.assetId !== undefined ? body.assetId : prior.assetId;
      const scale = uhdScale(spec);
      let dataUrl = '';
      try {
        dataUrl = await renderToDataUrl(spec, bgUrlForAsset(s, assetId), { scale });
      } catch {
        /* ignore */
      }
      s.galleryImages[idx] = {
        ...prior,
        assetId: assetId ?? null,
        width: spec.width * scale,
        height: spec.height * scale,
        sizeBytes: dataUrl.length,
        spec,
        updatedAt: nowIso(),
        dataUrl,
      };
      notify('Demo: image edits saved locally.');
      return delay(s.galleryImages[idx]);
    }
    if (method === 'DELETE') {
      s.galleryImages.splice(idx, 1);
      notify('Demo: image deleted (local only).');
      return delay({ ok: true });
    }
  }

  // Fallback
  return delay({ message: `Demo: route not implemented (${method} ${path})` });
}
