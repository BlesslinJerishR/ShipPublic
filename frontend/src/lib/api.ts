import { handleDemoRequest, isDemoMode } from './demo';

const browserApiBase =
  typeof window !== 'undefined'
    ? ((window as any).__API_BASE || process.env.NEXT_PUBLIC_API_URL || window.location.origin)
    : null;

export const API_BASE = (browserApiBase || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any, message?: string) {
    super(message || `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

// In-flight request de-duplication. Multiple components mounting at once and
// requesting the same GET will share a single network round-trip.
const inflight = new Map<string, Promise<any>>();

export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  if (isDemoMode()) {
    return (await handleDemoRequest(path, init)) as T;
  }
  const method = (init.method || 'GET').toUpperCase();
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;

  // Only de-duplicate idempotent reads.
  const dedupKey = method === 'GET' ? `GET ${url}` : null;
  if (dedupKey && inflight.has(dedupKey)) {
    return inflight.get(dedupKey)! as Promise<T>;
  }

  const exec = (async () => {
    const res = await fetch(url, {
      credentials: 'include',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new ApiError(res.status, data, data?.message || res.statusText);
    return data as T;
  })();

  if (dedupKey) {
    inflight.set(dedupKey, exec);
    exec.finally(() => inflight.delete(dedupKey));
  }
  return exec;
}

export const api = {
  me: () => apiFetch('/api/auth/me'),
  logout: () => apiFetch('/api/auth/logout'),
  projects: {
    list: () => apiFetch('/api/projects'),
    available: () => apiFetch('/api/projects/available'),
    add: (githubRepoId: number) =>
      apiFetch('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ githubRepoId }),
      }),
    get: (id: string) => apiFetch(`/api/projects/${id}`),
    remove: (id: string) => apiFetch(`/api/projects/${id}`, { method: 'DELETE' }),
    setAutoSync: (id: string, enabled: boolean) =>
      apiFetch(`/api/projects/${id}/auto-sync`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
    contributions: (id: string, from?: string, to?: string) => {
      const q = new URLSearchParams();
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      return apiFetch(`/api/projects/${id}/contributions?${q.toString()}`);
    },
  },
  commits: {
    list: (projectId: string, params: { from?: string; to?: string; take?: number } = {}) => {
      const q = new URLSearchParams();
      if (params.from) q.set('from', params.from);
      if (params.to) q.set('to', params.to);
      if (params.take) q.set('take', String(params.take));
      return apiFetch(`/api/projects/${projectId}/commits?${q.toString()}`);
    },
    sync: (projectId: string, body: any = {}) =>
      apiFetch(`/api/projects/${projectId}/commits/sync`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    aggregates: (projectId: string, from?: string, to?: string) => {
      const q = new URLSearchParams();
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      return apiFetch(`/api/projects/${projectId}/commits/aggregates?${q.toString()}`);
    },
    detail: (projectId: string, sha: string) =>
      apiFetch(`/api/projects/${projectId}/commits/${sha}`),
  },
  posts: {
    list: (projectId?: string) =>
      apiFetch(`/api/posts${projectId ? `?projectId=${projectId}` : ''}`),
    get: (id: string) => apiFetch(`/api/posts/${id}`),
    generate: (body: any) =>
      apiFetch('/api/posts/generate', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: any) =>
      apiFetch(`/api/posts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) => apiFetch(`/api/posts/${id}`, { method: 'DELETE' }),
  },
  gallery: {
    ratios: () => apiFetch('/api/gallery/ratios'),
    settings: {
      get: () => apiFetch('/api/gallery/settings'),
      update: (body: any) =>
        apiFetch('/api/gallery/settings', {
          method: 'PUT',
          body: JSON.stringify(body),
        }),
    },
    assets: {
      list: () => apiFetch('/api/gallery/assets'),
      upload: (body: { name: string; mimeType: string; base64: string }) =>
        apiFetch('/api/gallery/assets', { method: 'POST', body: JSON.stringify(body) }),
      remove: (id: string) =>
        apiFetch(`/api/gallery/assets/${id}`, { method: 'DELETE' }),
      // File URLs are emitted as relative paths so the browser hits Next's
      // /api rewrite proxy and cookie auth flows seamlessly.
      fileUrl: (id: string) => `/api/gallery/assets/${id}/file`,
    },
    images: {
      list: (postId?: string) =>
        apiFetch(`/api/gallery/images${postId ? `?postId=${postId}` : ''}`),
      get: (id: string) => apiFetch(`/api/gallery/images/${id}`),
      update: (id: string, body: any) =>
        apiFetch(`/api/gallery/images/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        }),
      remove: (id: string) =>
        apiFetch(`/api/gallery/images/${id}`, { method: 'DELETE' }),
      fileUrl: (id: string) => `/api/gallery/images/${id}/file`,
    },
    generate: (body: any) =>
      apiFetch('/api/gallery/generate', { method: 'POST', body: JSON.stringify(body) }),
  },
  news: {
    sources: {
      list: () => apiFetch('/api/news/sources'),
      create: (body: any) =>
        apiFetch('/api/news/sources', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      update: (id: string, body: any) =>
        apiFetch(`/api/news/sources/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        }),
      remove: (id: string) =>
        apiFetch(`/api/news/sources/${id}`, { method: 'DELETE' }),
    },
    items: {
      list: (params: { sourceId?: string; status?: string; take?: number } = {}) => {
        const q = new URLSearchParams();
        if (params.sourceId) q.set('sourceId', params.sourceId);
        if (params.status) q.set('status', params.status);
        if (params.take) q.set('take', String(params.take));
        return apiFetch(`/api/news/items?${q.toString()}`);
      },
      dismiss: (id: string) =>
        apiFetch(`/api/news/items/${id}/dismiss`, { method: 'PATCH' }),
    },
    refresh: (sourceIds?: string[]) =>
      apiFetch('/api/news/refresh', {
        method: 'POST',
        body: JSON.stringify({ sourceIds: sourceIds || [] }),
      }),
    generate: (body: { newsItemIds: string[]; platform?: string; tone?: string; assetId?: string | null }) =>
      apiFetch('/api/news/generate', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
};
