/**
 * Client helpers that turn the per-post `GalleryImage` rows into multi-page
 * ZIP / PDF downloads. In real-backend mode they hit the NestJS endpoints
 * (`/api/gallery/posts/:id/download.zip`, `download.pdf`,
 * `/api/gallery/download.zip` for bundles). In demo mode they assemble the
 * archive client-side from the data URLs already cached in the demo store
 * so users can experience the full export flow without a backend.
 *
 * Page ordering is critical: page 1 = AI illustration (`spec.kind === 'AI_IMAGE'`),
 * page 2 = text-on-bg composite. This mirrors backend `loadPostPages`.
 */

import { api, apiFetch } from './api';
import { isDemoMode } from './demo';
import { downloadDataUrl } from './gallery-render';
import type { GalleryImage, Post } from './types';

function slugify(s: string): string {
  return (
    (s || 'shipublic-post')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'shipublic-post'
  );
}

function pageOf(img: GalleryImage): number {
  const spec: any = img.spec || {};
  if (typeof spec.page === 'number') return spec.page;
  return spec.kind === 'AI_IMAGE' ? 1 : 2;
}

function orderedPages(images: GalleryImage[]): GalleryImage[] {
  return [...images].sort((a, b) => pageOf(a) - pageOf(b));
}

async function imageToBytes(img: GalleryImage): Promise<Uint8Array> {
  if (img.dataUrl) {
    const res = await fetch(img.dataUrl);
    return new Uint8Array(await res.arrayBuffer());
  }
  const res = await fetch(api.gallery.images.fileUrl(img.id), {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`fetch image ${img.id} failed`);
  return new Uint8Array(await res.arrayBuffer());
}

async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
}

/**
 * Build and trigger a ZIP download containing every page rendered for `post`.
 * Always fires the browser save dialog whether running against the real
 * backend or the in-memory demo store.
 */
export async function downloadPostZip(post: Post): Promise<void> {
  const slug = slugify(post.title || post.content || post.id);
  if (!isDemoMode()) {
    const res = await fetch(`/api/gallery/posts/${post.id}/download.zip`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error('zip download failed');
    const blob = await res.blob();
    await downloadBlob(blob, `shipublic-${slug}.zip`);
    return;
  }
  // Demo mode: assemble a ZIP from the cached data URLs.
  const list = (await api.gallery.images.list(post.id)) as GalleryImage[];
  const pages = orderedPages(list);
  if (!pages.length) throw new Error('no images for this post yet');
  const JSZipMod: any = await import('jszip');
  const JSZip = JSZipMod.default || JSZipMod;
  const zip = new JSZip();
  let i = 1;
  for (const img of pages) {
    const ext = img.mimeType?.includes('jpeg') ? 'jpg' : 'png';
    const label = pageOf(img) === 1 ? 'page-1-ai-image' : 'page-2-post';
    const name = `${String(i).padStart(2, '0')}-${label}.${ext}`;
    zip.file(name, await imageToBytes(img));
    i++;
  }
  const blob: Blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
  });
  await downloadBlob(blob, `shipublic-${slug}.zip`);
}

/**
 * Build a multi-post ZIP. Each post becomes its own folder containing its
 * ordered pages — same layout the backend produces.
 */
export async function downloadBundleZip(
  posts: Post[],
  postIds?: string[],
): Promise<void> {
  const ids = postIds && postIds.length ? postIds : posts.map((p) => p.id);
  if (!ids.length) throw new Error('no posts to bundle');
  if (!isDemoMode()) {
    const url =
      `/api/gallery/download.zip` +
      (postIds && postIds.length ? `?postIds=${encodeURIComponent(ids.join(','))}` : '');
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('bundle download failed');
    const blob = await res.blob();
    const today = new Date().toISOString().slice(0, 10);
    await downloadBlob(blob, `shipublic-bundle-${today}.zip`);
    return;
  }
  // Demo mode: gather every image grouped per post.
  const JSZipMod: any = await import('jszip');
  const JSZip = JSZipMod.default || JSZipMod;
  const zip = new JSZip();
  let added = 0;
  for (const post of posts) {
    if (!ids.includes(post.id)) continue;
    try {
      const list = (await api.gallery.images.list(post.id)) as GalleryImage[];
      const pages = orderedPages(list);
      if (!pages.length) continue;
      const slug = slugify(post.title || post.content || post.id);
      const folder = zip.folder(`${slug}-${post.id.slice(-6)}`);
      if (!folder) continue;
      let i = 1;
      for (const img of pages) {
        const ext = img.mimeType?.includes('jpeg') ? 'jpg' : 'png';
        const label = pageOf(img) === 1 ? 'page-1-ai-image' : 'page-2-post';
        folder.file(`${String(i).padStart(2, '0')}-${label}.${ext}`, await imageToBytes(img));
        i++;
      }
      added++;
    } catch {
      /* skip posts with no images */
    }
  }
  if (!added) throw new Error('no images to bundle');
  const blob: Blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
  });
  const today = new Date().toISOString().slice(0, 10);
  await downloadBlob(blob, `shipublic-bundle-${today}.zip`);
}

/**
 * PDF export for a single post. Real-mode hits the backend `pdf-lib`-powered
 * endpoint. Demo mode is intentionally not implemented — the user prompt
 * only mandates ZIP for demo. The button surfaces a friendly notice.
 */
export async function downloadPostPdf(post: Post): Promise<void> {
  const slug = slugify(post.title || post.content || post.id);
  if (isDemoMode()) {
    // Best-effort demo: stitch images into a single multi-page PDF using a
    // tiny inline writer would be heavy. Instead we ZIP them and tell the
    // user demo PDF requires the backend.
    await downloadPostZip(post);
    return;
  }
  const res = await fetch(`/api/gallery/posts/${post.id}/download.pdf`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('pdf download failed');
  const blob = await res.blob();
  await downloadBlob(blob, `shipublic-${slug}.pdf`);
}

// `apiFetch` is re-exported here so callers can import everything from the
// same module if they need to extend (e.g. add a custom export route).
export { apiFetch };
