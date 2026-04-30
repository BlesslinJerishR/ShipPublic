'use client';

/**
 * /dashboard/gallery
 *
 * The Gallery sidebar module surfaces three things in one place:
 *
 *  1. Backgrounds — upload, preview and delete the BG images that get
 *     composited under the build-in-public post text.
 *  2. Defaults — ratio + margin + font + color settings that every newly
 *     generated image inherits.
 *  3. Library — every previously generated image, with view, download and
 *     delete actions.
 *
 * In demo mode all reads/writes are routed to the in-memory store via
 * `apiFetch` → `handleDemoRequest`, and rendered images live as data URLs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Upload,
  Trash2,
  Star,
  StarOff,
  Download,
  FileArchive,
  Image as ImageIcon,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import { Card } from '@/components/Card';
import { Select } from '@/components/Select';
import { api } from '@/lib/api';
import { useApi, invalidate } from '@/lib/useApi';
import { downloadDataUrl } from '@/lib/gallery-render';
import { downloadPostZip, downloadBundleZip } from '@/lib/gallery-bundle';
import { FONT_FAMILIES, RATIOS } from '@/lib/gallery-ratios';
import type {
  GalleryAsset,
  GalleryImage,
  GallerySettings,
  Post,
} from '@/lib/types';
import styles from './gallery.module.css';

export default function GalleryPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data: assets = [], mutate: mutateAssets } = useApi<GalleryAsset[]>(
    'gallery:assets',
    () => api.gallery.assets.list() as Promise<GalleryAsset[]>,
  );
  const { data: settings, mutate: mutateSettings } = useApi<GallerySettings>(
    'gallery:settings',
    () => api.gallery.settings.get() as Promise<GallerySettings>,
  );
  const { data: images = [], mutate: mutateImages } = useApi<GalleryImage[]>(
    'gallery:images',
    () => api.gallery.images.list() as Promise<GalleryImage[]>,
  );
  const { data: posts = [] } = useApi<Post[]>(
    'posts:list',
    () => api.posts.list() as Promise<Post[]>,
  );

  // Local copies of mutable settings fields so sliders feel snappy without
  // round-tripping every keystroke.
  const [draft, setDraft] = useState<GallerySettings | null>(null);
  useEffect(() => {
    if (settings && !draft) setDraft(settings);
  }, [settings, draft]);
  useEffect(() => {
    // Re-seed when remote settings change (e.g. after upload sets defaultAssetId).
    if (settings) setDraft((d) => ({ ...settings, ...(d || {}) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.id, settings?.defaultAssetId, settings?.updatedAt]);

  const dirty = useMemo(() => {
    if (!draft || !settings) return false;
    const keys: (keyof GallerySettings)[] = [
      'defaultRatio',
      'marginTopPct',
      'marginBottomPct',
      'marginLeftPct',
      'marginRightPct',
      'fontFamily',
      'fontSize',
      'fontColor',
      'textAlign',
      'verticalAlign',
      'bgFit',
      'bgFillColor',
      'autoGenerate',
    ];
    return keys.some((k) => draft[k] !== settings[k]);
  }, [draft, settings]);

  const saveSettings = useCallback(async () => {
    if (!draft) return;
    const next = (await api.gallery.settings.update({
      defaultRatio: draft.defaultRatio,
      marginTopPct: draft.marginTopPct,
      marginBottomPct: draft.marginBottomPct,
      marginLeftPct: draft.marginLeftPct,
      marginRightPct: draft.marginRightPct,
      fontFamily: draft.fontFamily,
      fontSize: draft.fontSize,
      fontColor: draft.fontColor,
      textAlign: draft.textAlign,
      verticalAlign: draft.verticalAlign,
      bgFit: draft.bgFit,
      bgFillColor: draft.bgFillColor,
      autoGenerate: draft.autoGenerate,
    })) as GallerySettings;
    await mutateSettings(next);
  }, [draft, mutateSettings]);

  const setDefaultAsset = useCallback(
    async (assetId: string | null) => {
      const next = (await api.gallery.settings.update({
        defaultAssetId: assetId,
      })) as GallerySettings;
      await mutateSettings(next);
    },
    [mutateSettings],
  );

  const onPickFile = useCallback(() => fileInputRef.current?.click(), []);

  const onUpload = useCallback(
    async (file: File) => {
      setUploadError(null);
      setUploading(true);
      try {
        // Read file → base64. FileReader is universally supported and avoids
        // pulling in Buffer just for the encode.
        const base64: string = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => {
            const result = String(r.result || '');
            const idx = result.indexOf(',');
            resolve(idx >= 0 ? result.slice(idx + 1) : result);
          };
          r.onerror = () => reject(r.error || new Error('read failed'));
          r.readAsDataURL(file);
        });
        const created = (await api.gallery.assets.upload({
          name: file.name,
          mimeType: file.type || 'image/png',
          base64,
        })) as GalleryAsset;
        await mutateAssets(([created, ...((assets || []) as GalleryAsset[])]) as any);
        invalidate('gallery:settings');
      } catch (err: any) {
        setUploadError(err?.message || 'upload failed');
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [assets, mutateAssets],
  );

  const removeAsset = useCallback(
    async (id: string) => {
      if (!confirm('Delete this background?')) return;
      await api.gallery.assets.remove(id);
      await mutateAssets((prev) => (prev || []).filter((a) => a.id !== id));
      invalidate('gallery:settings');
    },
    [mutateAssets],
  );

  const postById = useMemo(() => {
    const m = new Map<string, Post>();
    for (const p of posts) m.set(p.id, p);
    return m;
  }, [posts]);

  const downloadImage = useCallback(async (img: GalleryImage) => {
    if (img.dataUrl) {
      downloadDataUrl(img.dataUrl, `shipublic-${img.id}.png`);
      return;
    }
    // Real backend path — fetch through the same-origin /api proxy so the
    // session cookie travels with the request, then save the blob.
    try {
      const res = await fetch(api.gallery.images.fileUrl(img.id), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      downloadDataUrl(url, `shipublic-${img.id}.png`);
    } catch (e) {
      alert('Could not download image.');
    }
  }, []);

  const downloadGroupZip = useCallback(
    async (post: Post | null) => {
      if (!post) return;
      try {
        await downloadPostZip(post);
      } catch (e: any) {
        alert(e?.message || 'Could not build ZIP');
      }
    },
    [],
  );

  const downloadAllZip = useCallback(async () => {
    if (!posts.length) {
      alert('No posts yet.');
      return;
    }
    try {
      await downloadBundleZip(posts);
    } catch (e: any) {
      alert(e?.message || 'Could not build bundle');
    }
  }, [posts]);

  const previewSrc = useCallback((img: GalleryImage) => {
    if (img.dataUrl) return img.dataUrl;
    return api.gallery.images.fileUrl(img.id);
  }, []);

  const assetSrc = useCallback((a: GalleryAsset) => {
    if (a.url) return a.url;
    return api.gallery.assets.fileUrl(a.id);
  }, []);

  if (!draft) return <div className={styles.muted}>Loading gallery</div>;

  return (
    <div className={styles.wrap}>
      <div>
        <h2 className={styles.title}>Gallery</h2>
        <div className={styles.subtitle}>
          Upload backgrounds, set the canvas defaults Shipublic uses for every
          generated build-in-public post image, and re-download anything you
          shipped before.
        </div>
      </div>

      <div className={styles.row2}>
        <Card
          title="Backgrounds"
          action={
            <button onClick={onPickFile} disabled={uploading} className="heroBtn">
              <Upload size={14} /> {uploading ? 'Uploading' : 'Upload background'}
            </button>
          }
        >
          <p className={styles.muted}>
            PNG, JPEG or WebP up to 8&nbsp;MB. The first upload becomes your
            default background. Pick a different default any time with the star.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
          />
          {uploadError && (
            <div className={styles.error}>Upload failed: {uploadError}</div>
          )}
          <div className={styles.assetGrid}>
            {assets.map((a) => {
              const isDefault = settings?.defaultAssetId === a.id;
              return (
                <div key={a.id} className={`${styles.assetCard} ${isDefault ? styles.assetActive : ''}`}>
                  <div className={styles.assetThumb}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={assetSrc(a)} alt={a.name} loading="lazy" />
                  </div>
                  <div className={styles.assetMeta}>
                    <div className={styles.assetName} title={a.name}>{a.name}</div>
                    <div className={styles.assetSub}>
                      {a.width}×{a.height}
                      {a.isDefault ? ' · bundled' : ''}
                    </div>
                  </div>
                  <div className={styles.assetActions}>
                    <button
                      onClick={() => setDefaultAsset(isDefault ? null : a.id)}
                      title={isDefault ? 'Unset as default' : 'Use as default'}
                    >
                      {isDefault ? <Star size={14} /> : <StarOff size={14} />}
                    </button>
                    {!a.isDefault && (
                      <button onClick={() => removeAsset(a.id)} title="Delete">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {assets.length === 0 && (
              <div className={styles.muted}>No backgrounds yet.</div>
            )}
          </div>
        </Card>

        <Card
          title="Canvas defaults"
          action={
            dirty ? (
              <button className="heroBtn" onClick={saveSettings}>
                Save defaults
              </button>
            ) : null
          }
        >
          <div className={styles.fieldGrid}>
            <div>
              <div className={styles.fieldLabel}>Default ratio</div>
              <Select
                value={draft.defaultRatio}
                onChange={(v) => setDraft({ ...draft, defaultRatio: v })}
                options={RATIOS.map((r) => ({ value: r.id, label: r.label }))}
                fullWidth
              />
            </div>
            <div>
              <div className={styles.fieldLabel}>Background fit</div>
              <Select
                value={draft.bgFit}
                onChange={(v) => setDraft({ ...draft, bgFit: v as any })}
                options={[
                  { value: 'cover', label: 'Cover (crop to fill)' },
                  { value: 'contain', label: 'Contain (fit + fill)' },
                ]}
                fullWidth
              />
            </div>
            <div>
              <div className={styles.fieldLabel}>Font</div>
              <Select
                value={draft.fontFamily}
                onChange={(v) => setDraft({ ...draft, fontFamily: v })}
                options={FONT_FAMILIES.map((f) => ({ value: f, label: f }))}
                fullWidth
              />
            </div>
            <div>
              <div className={styles.fieldLabel}>Text alignment</div>
              <Select
                value={draft.textAlign}
                onChange={(v) => setDraft({ ...draft, textAlign: v as any })}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'center', label: 'Center' },
                  { value: 'right', label: 'Right' },
                ]}
                fullWidth
              />
            </div>
            <div>
              <div className={styles.fieldLabel}>Vertical alignment</div>
              <Select
                value={draft.verticalAlign}
                onChange={(v) => setDraft({ ...draft, verticalAlign: v as any })}
                options={[
                  { value: 'start', label: 'Top' },
                  { value: 'center', label: 'Center' },
                  { value: 'end', label: 'Bottom' },
                ]}
                fullWidth
              />
            </div>
            <div>
              <div className={styles.fieldLabel}>Font size · {draft.fontSize}px</div>
              <input
                type="range"
                min={20}
                max={140}
                value={draft.fontSize}
                onChange={(e) => setDraft({ ...draft, fontSize: Number(e.target.value) })}
                className={styles.range}
              />
            </div>
            <div>
              <div className={styles.fieldLabel}>Text color</div>
              <input
                type="color"
                value={draft.fontColor}
                onChange={(e) => setDraft({ ...draft, fontColor: e.target.value })}
                className={styles.color}
              />
            </div>
            <div>
              <div className={styles.fieldLabel}>Fill color (contain mode)</div>
              <input
                type="color"
                value={draft.bgFillColor}
                onChange={(e) => setDraft({ ...draft, bgFillColor: e.target.value })}
                className={styles.color}
              />
            </div>
          </div>

          <div className={styles.marginGrid}>
            {([
              ['marginTopPct', 'Top margin %'],
              ['marginBottomPct', 'Bottom margin %'],
              ['marginLeftPct', 'Left margin %'],
              ['marginRightPct', 'Right margin %'],
            ] as const).map(([k, label]) => (
              <div key={k}>
                <div className={styles.fieldLabel}>
                  {label} · {Math.round((draft[k] as number))}%
                </div>
                <input
                  type="range"
                  min={0}
                  max={45}
                  step={1}
                  value={draft[k] as number}
                  onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) } as any)}
                  className={styles.range}
                />
              </div>
            ))}
          </div>

          <label className={styles.toggle}>
            <input
              type="checkbox"
              className="redCheck"
              checked={draft.autoGenerate}
              onChange={(e) => setDraft({ ...draft, autoGenerate: e.target.checked })}
            />
            <span>
              Auto-generate an image whenever a build-in-public post finishes
              generating
            </span>
          </label>
        </Card>
      </div>

      <Card
        title="Generated images"
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={downloadAllZip}
              disabled={!images.length}
              title="Download every post's pages, grouped by post, as one ZIP"
            >
              <FileArchive size={14} /> Download all as ZIP
            </button>
            <Link prefetch={false} href="/dashboard/posts">
              <button>Browse posts</button>
            </Link>
          </div>
        }
      >
        {images.length === 0 && (
          <div className={styles.muted}>
            <ImageIcon size={14} /> No images yet. Generate a post and Shipublic
            will render its image automatically.
          </div>
        )}
        <div className={styles.imageGrid}>
          {(() => {
            // Each post can have up to two pages: a text-on-bg \"POST\" page and
            // an \"AI_IMAGE\" page produced by ComfyUI. The thumbnail prefers
            // the AI image so users see the illustration first; both are still
            // independently downloadable from the same card. Images without
            // a postId (e.g. ad-hoc renders) get their own card.
            type Group = { key: string; post: Post | null; ai: GalleryImage | null; bg: GalleryImage | null; orphans: GalleryImage[] };
            const byPost = new Map<string, Group>();
            const orphans: GalleryImage[] = [];
            for (const img of images) {
              if (!img.postId) { orphans.push(img); continue; }
              const g = byPost.get(img.postId) || {
                key: img.postId,
                post: postById.get(img.postId) || null,
                ai: null, bg: null, orphans: [],
              };
              if (img.spec?.kind === 'AI_IMAGE') g.ai = g.ai || img;
              else g.bg = g.bg || img;
              byPost.set(img.postId, g);
            }
            const groups: Group[] = [
              ...Array.from(byPost.values()),
              ...orphans.map((o) => ({ key: o.id, post: null, ai: null, bg: o, orphans: [] } as Group)),
            ];

            return groups.map((g) => {
              const preview = g.ai || g.bg;
              if (!preview) return null;
              const post = g.post;
              return (
                <div key={g.key} className={styles.imageCard}>
                  <div className={styles.imageThumb}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewSrc(preview)} alt={`Image ${preview.id}`} loading="lazy" />
                    {preview.status === 'FAILED' && (
                      <div className={styles.failedBadge}>render failed</div>
                    )}
                    {g.ai && g.bg && (
                      <div className={styles.failedBadge} style={{ background: 'rgba(0,0,0,0.55)' }}>
                        AI + text page
                      </div>
                    )}
                  </div>
                  <div className={styles.imageMeta}>
                    <div className={styles.imageTitle} title={post?.title || ''}>
                      {post?.title || post?.content?.slice(0, 80) || 'Untitled post'}
                    </div>
                    <div className={styles.assetSub}>
                      {preview.width}×{preview.height} · {preview.spec.ratio}
                      {g.ai ? ' · AI image' : ''}
                    </div>
                  </div>
                  <div className={styles.imageActions}>
                    {post && (
                      <Link
                        prefetch={false}
                        href={`/dashboard/posts/${post.id}/image`}
                        className={styles.iconLink}
                        title="Edit text page"
                      >
                        <Pencil size={14} />
                      </Link>
                    )}
                    {g.ai && (
                      <button onClick={() => downloadImage(g.ai!)} title="Download AI image">
                        <Download size={14} />
                      </button>
                    )}
                    {g.bg && (
                      <button
                        onClick={() => downloadImage(g.bg!)}
                        title={g.ai ? 'Download text page' : 'Download'}
                        style={g.ai ? { opacity: 0.7 } : undefined}
                      >
                        <Download size={14} />
                      </button>
                    )}
                    {post && (g.ai || g.bg) && (
                      <button
                        onClick={() => downloadGroupZip(post)}
                        title="Download both pages (AI image + text page) as ZIP"
                      >
                        <FileArchive size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        // Delete both pages together when present so the gallery
                        // does not end up showing only half of a post's output.
                        if (!confirm('Delete this image (and its other page if any)?')) return;
                        const ids = [g.ai?.id, g.bg?.id].filter(Boolean) as string[];
                        Promise.all(ids.map((id) => api.gallery.images.remove(id))).then(() =>
                          mutateImages((prev) => (prev || []).filter((x) => !ids.includes(x.id))),
                        );
                      }}
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </Card>
    </div>
  );
}
