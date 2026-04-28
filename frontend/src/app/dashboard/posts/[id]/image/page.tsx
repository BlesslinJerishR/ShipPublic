'use client';

/**
 * /dashboard/posts/[id]/image
 *
 * Custom post image editor — a focused single-purpose page that lets the
 * user override the generated image's content, ratio, margins, font, color
 * and text position. The preview is rendered with the shared client canvas
 * renderer so what the user sees here matches what the backend SVG renderer
 * will produce when "Save & re-render" is clicked.
 *
 * Demo mode persists edits to the in-memory store, so the page works
 * end-to-end without a running backend.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Download,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Card } from '@/components/Card';
import { Select } from '@/components/Select';
import { api } from '@/lib/api';
import {
  downloadDataUrl,
  normaliseSpec,
  renderToCanvas,
  renderToDataUrl,
  uhdScale,
  type RenderSpec,
} from '@/lib/gallery-render';
import { FONT_FAMILIES, RATIOS, getRatio } from '@/lib/gallery-ratios';
import type {
  GalleryAsset,
  GalleryImage,
  GallerySettings,
  Post,
} from '@/lib/types';
import styles from './image.module.css';

const DEFAULT_RATIO = 'INSTAGRAM_PORTRAIT';

export default function PostImageEditorPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const postId = params.id;

  const [post, setPost] = useState<Post | null>(null);
  const [image, setImage] = useState<GalleryImage | null>(null);
  const [assets, setAssets] = useState<GalleryAsset[]>([]);
  const [settings, setSettings] = useState<GallerySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [assetId, setAssetId] = useState<string | null>(null);
  const [spec, setSpec] = useState<RenderSpec>(() => normaliseSpec({ ratio: DEFAULT_RATIO }));

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragState = useRef<{
    startX: number;
    startY: number;
    baseOffsetX: number;
    baseOffsetY: number;
    scale: number;
  } | null>(null);

  // ---- initial load ----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [postRow, assetList, settingsRow, imageList] = await Promise.all([
          api.posts.get(postId) as Promise<Post>,
          api.gallery.assets.list() as Promise<GalleryAsset[]>,
          api.gallery.settings.get() as Promise<GallerySettings>,
          api.gallery.images.list(postId) as Promise<GalleryImage[]>,
        ]);
        if (cancelled) return;
        setPost(postRow);
        setAssets(assetList);
        setSettings(settingsRow);
        const existing = imageList[0] || null;
        setImage(existing);
        if (existing) {
          setAssetId(existing.assetId);
          setSpec(normaliseSpec({ ...existing.spec, content: existing.spec.content || postRow.content }));
        } else {
          setAssetId(settingsRow.defaultAssetId);
          setSpec(
            normaliseSpec({
              ratio: settingsRow.defaultRatio,
              marginTopPct: settingsRow.marginTopPct,
              marginBottomPct: settingsRow.marginBottomPct,
              marginLeftPct: settingsRow.marginLeftPct,
              marginRightPct: settingsRow.marginRightPct,
              fontFamily: settingsRow.fontFamily,
              fontSize: settingsRow.fontSize,
              fontColor: settingsRow.fontColor,
              textAlign: settingsRow.textAlign,
              verticalAlign: settingsRow.verticalAlign,
              bgFit: settingsRow.bgFit,
              bgFillColor: settingsRow.bgFillColor,
              content: postRow.content || '',
            }),
          );
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.body?.message || err?.message || 'failed to load editor');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [postId]);

  // ---- background URL helper -------------------------------------------------
  const bgUrl = useMemo(() => {
    if (!assetId) {
      const fallback = assets.find((a) => a.isDefault) || assets[0];
      if (!fallback) return null;
      return fallback.url || api.gallery.assets.fileUrl(fallback.id);
    }
    const a = assets.find((x) => x.id === assetId);
    if (!a) return null;
    return a.url || api.gallery.assets.fileUrl(a.id);
  }, [assetId, assets]);

  // ---- live preview render ---------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    if (!canvasRef.current) return;
    (async () => {
      try {
        await renderToCanvas(spec, bgUrl, canvasRef.current!);
        if (cancelled) return;
        // For the download fallback we keep a snapshot of the current preview
        // as a data URL — fast O(1) operation on a 1080×1350 canvas.
        const url = canvasRef.current!.toDataURL('image/png');
        if (!cancelled) setPreviewUrl(url);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'preview render failed');
      }
    })();
    return () => { cancelled = true; };
  }, [spec, bgUrl]);

  // ---- spec helpers ----------------------------------------------------------
  const update = useCallback(<K extends keyof RenderSpec>(key: K, value: RenderSpec[K]) => {
    setSpec((prev) => normaliseSpec({ ...prev, [key]: value }));
  }, []);

  const onRatioChange = useCallback((id: string) => {
    const r = getRatio(id);
    setSpec((prev) => normaliseSpec({ ...prev, ratio: r.id, offsetX: 0, offsetY: 0 }));
  }, []);

  const resetOffsets = useCallback(() => {
    setSpec((prev) => normaliseSpec({ ...prev, offsetX: 0, offsetY: 0 }));
  }, []);

  // ---- pointer drag for repositioning the text -------------------------------
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    // The canvas is rendered at native pixel size and scaled down with CSS,
    // so we map screen-space deltas back into source-pixel space for offsetX/Y.
    const scale = canvas.width / Math.max(1, rect.width);
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseOffsetX: spec.offsetX || 0,
      baseOffsetY: spec.offsetY || 0,
      scale,
    };
    canvas.setPointerCapture(e.pointerId);
  }, [spec.offsetX, spec.offsetY]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = dragState.current;
    if (!st) return;
    const dx = (e.clientX - st.startX) * st.scale;
    const dy = (e.clientY - st.startY) * st.scale;
    setSpec((prev) => normaliseSpec({
      ...prev,
      offsetX: Math.round(st.baseOffsetX + dx),
      offsetY: Math.round(st.baseOffsetY + dy),
    }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragState.current) return;
    dragState.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }, []);

  // ---- save / generate / download -------------------------------------------
  const saveAndRender = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      let saved: GalleryImage;
      if (image) {
        saved = (await api.gallery.images.update(image.id, {
          assetId,
          ratio: spec.ratio,
          marginTopPct: spec.marginTopPct,
          marginBottomPct: spec.marginBottomPct,
          marginLeftPct: spec.marginLeftPct,
          marginRightPct: spec.marginRightPct,
          fontFamily: spec.fontFamily,
          fontSize: spec.fontSize,
          fontColor: spec.fontColor,
          textAlign: spec.textAlign,
          verticalAlign: spec.verticalAlign,
          bgFit: spec.bgFit,
          bgFillColor: spec.bgFillColor,
          content: spec.content,
          offsetX: spec.offsetX,
          offsetY: spec.offsetY,
        })) as GalleryImage;
      } else {
        saved = (await api.gallery.generate({
          postId,
          assetId,
          ratio: spec.ratio,
          marginTopPct: spec.marginTopPct,
          marginBottomPct: spec.marginBottomPct,
          marginLeftPct: spec.marginLeftPct,
          marginRightPct: spec.marginRightPct,
          fontFamily: spec.fontFamily,
          fontSize: spec.fontSize,
          fontColor: spec.fontColor,
          textAlign: spec.textAlign,
          verticalAlign: spec.verticalAlign,
          bgFit: spec.bgFit,
          bgFillColor: spec.bgFillColor,
          content: spec.content,
          offsetX: spec.offsetX,
          offsetY: spec.offsetY,
        })) as GalleryImage;
      }
      setImage(saved);
    } catch (err: any) {
      setError(err?.body?.message || err?.message || 'save failed');
    } finally {
      setSaving(false);
    }
  }, [image, assetId, spec, postId]);

  const downloadCurrent = useCallback(async () => {
    // Render fresh from the current spec at >= UHD so the downloaded file is
    // always full-resolution, regardless of how small the editor preview is.
    try {
      const url = await renderToDataUrl(spec, bgUrl, { scale: uhdScale(spec) });
      downloadDataUrl(url, `shipublic-${postId}.png`);
    } catch {
      if (previewUrl) downloadDataUrl(previewUrl, `shipublic-${postId}.png`);
    }
  }, [spec, bgUrl, previewUrl, postId]);

  const removeImage = useCallback(async () => {
    if (!image) return;
    if (!confirm('Delete this generated image?')) return;
    await api.gallery.images.remove(image.id);
    setImage(null);
  }, [image]);

  if (loading) return <div className={styles.muted}>Loading editor</div>;
  if (!post) return <div className={styles.muted}>{error || 'Post not found.'}</div>;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <button onClick={() => router.back()}><ArrowLeft size={14} /> Back</button>
        <div className={styles.title}>Edit post image</div>
        <Link prefetch={false} href={`/dashboard/posts/${post.id}`} className={styles.muted}>
          Back to post
        </Link>
      </div>

      <div className={styles.layout}>
        <Card title="Preview">
          <div className={styles.canvasWrap}>
            <div
              className={styles.canvasFrame}
              style={{ aspectRatio: `${spec.width} / ${spec.height}` }}
            >
              <canvas
                ref={canvasRef}
                className={styles.canvas}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </div>
            <div className={styles.canvasMeta}>
              <span>{spec.width}×{spec.height} ({spec.ratio.toLowerCase()})</span>
              <span>offset {spec.offsetX || 0}, {spec.offsetY || 0}</span>
              <button onClick={resetOffsets} className={styles.smallBtn}>
                <RefreshCw size={11} /> reset position
              </button>
            </div>
            {error && <div className={styles.error}>{error}</div>}
          </div>

          <div className={styles.actions}>
            <button className="heroBtn" onClick={saveAndRender} disabled={saving}>
              <Save size={14} /> {saving ? 'Saving' : image ? 'Save & re-render' : 'Render & save'}
            </button>
            <button onClick={downloadCurrent}>
              <Download size={14} /> Download preview
            </button>
            {image && (
              <button onClick={removeImage} title="Delete generated image">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </Card>

        <Card title="Layout">
          <div className={styles.fields}>
            <div>
              <div className={styles.label}>Ratio</div>
              <Select
                value={spec.ratio}
                onChange={(v) => onRatioChange(v)}
                options={RATIOS.map((r) => ({ value: r.id, label: r.label }))}
                fullWidth
              />
            </div>
            <div>
              <div className={styles.label}>Background</div>
              <Select
                value={assetId || ''}
                onChange={(v) => setAssetId(v || null)}
                options={[
                  { value: '', label: 'Use gallery default' },
                  ...assets.map((a) => ({
                    value: a.id,
                    label: a.isDefault ? `${a.name} (bundled)` : a.name,
                  })),
                ]}
                fullWidth
              />
            </div>
            <div>
              <div className={styles.label}>Background fit</div>
              <Select
                value={spec.bgFit}
                onChange={(v) => update('bgFit', v as any)}
                options={[
                  { value: 'cover', label: 'Cover (crop to fill)' },
                  { value: 'contain', label: 'Contain (fit + fill)' },
                ]}
                fullWidth
              />
            </div>
            <div>
              <div className={styles.label}>Fill color</div>
              <input
                type="color"
                className={styles.colorInput}
                value={spec.bgFillColor}
                onChange={(e) => update('bgFillColor', e.target.value)}
              />
            </div>
          </div>

          <div className={styles.fields}>
            {([
              ['marginTopPct', 'Top margin %'],
              ['marginBottomPct', 'Bottom margin %'],
              ['marginLeftPct', 'Left margin %'],
              ['marginRightPct', 'Right margin %'],
            ] as const).map(([k, label]) => (
              <div key={k}>
                <div className={styles.label}>{label} · {Math.round(spec[k] as number)}%</div>
                <input
                  type="range"
                  min={0}
                  max={45}
                  step={1}
                  value={spec[k] as number}
                  onChange={(e) => update(k, Number(e.target.value) as any)}
                  className={styles.range}
                />
              </div>
            ))}
          </div>
        </Card>

        <Card title="Type">
          <div className={styles.fields}>
            <div>
              <div className={styles.label}>Font</div>
              <Select
                value={spec.fontFamily}
                onChange={(v) => update('fontFamily', v)}
                options={FONT_FAMILIES.map((f) => ({ value: f, label: f }))}
                fullWidth
              />
            </div>
            <div>
              <div className={styles.label}>Font size · {spec.fontSize}px</div>
              <input
                type="range"
                min={20}
                max={140}
                value={spec.fontSize}
                onChange={(e) => update('fontSize', Number(e.target.value))}
                className={styles.range}
              />
            </div>
            <div>
              <div className={styles.label}>Text color</div>
              <input
                type="color"
                className={styles.colorInput}
                value={spec.fontColor}
                onChange={(e) => update('fontColor', e.target.value)}
              />
            </div>
            <div>
              <div className={styles.label}>Horizontal align</div>
              <Select
                value={spec.textAlign}
                onChange={(v) => update('textAlign', v as any)}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'center', label: 'Center' },
                  { value: 'right', label: 'Right' },
                ]}
                fullWidth
              />
            </div>
            <div>
              <div className={styles.label}>Vertical align</div>
              <Select
                value={spec.verticalAlign}
                onChange={(v) => update('verticalAlign', v as any)}
                options={[
                  { value: 'start', label: 'Top' },
                  { value: 'center', label: 'Center' },
                  { value: 'end', label: 'Bottom' },
                ]}
                fullWidth
              />
            </div>
          </div>

          <div className={styles.contentEditor}>
            <div className={styles.label}>
              <Sparkles size={11} /> Image text (overrides post body in the image only)
            </div>
            <textarea
              value={spec.content}
              onChange={(e) => update('content', e.target.value)}
              rows={6}
              placeholder="Build-in-public copy that appears on the image"
            />
            <div className={styles.muted} style={{ marginTop: 4 }}>
              Tip: drag the preview to nudge the text block — useful when your
              background has a header/footer to dodge.
            </div>
          </div>

          <div className={styles.helperRow}>
            <button
              onClick={() => update('content', post.content || '')}
              className={styles.smallBtn}
            >
              Reset to post body
            </button>
            {settings && (
              <Link prefetch={false} href="/dashboard/gallery" className={styles.smallBtn}>
                Edit gallery defaults
              </Link>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
