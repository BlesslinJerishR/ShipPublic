/**
 * Shared client-side renderer used by:
 *   - the live editor preview
 *   - the demo workspace (no backend round-trip)
 *
 * Wrapping uses the same character-width heuristic as the server SVG renderer
 * so the editor preview matches the saved PNG.
 */

import { FONT_CSS, getRatio } from './gallery-ratios';

export interface RenderSpec {
  ratio: string;
  width: number;
  height: number;
  marginTopPct: number;
  marginBottomPct: number;
  marginLeftPct: number;
  marginRightPct: number;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'start' | 'center' | 'end';
  bgFit: 'cover' | 'contain';
  bgFillColor: string;
  content: string;
  offsetX?: number;
  offsetY?: number;
}

export interface PartialRenderSpec extends Partial<Omit<RenderSpec, 'ratio'>> {
  ratio?: string;
}

export const DEFAULT_SPEC: RenderSpec = {
  ratio: 'INSTAGRAM_PORTRAIT',
  width: 1080,
  height: 1350,
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
  content: '',
  offsetX: 0,
  offsetY: 0,
};

export function normaliseSpec(input: PartialRenderSpec | undefined | null): RenderSpec {
  const p = input || {};
  const r = getRatio(p.ratio);
  const clampPct = (n: any, def: number) => {
    const v = typeof n === 'number' ? n : Number(n);
    if (!Number.isFinite(v)) return def;
    return Math.max(0, Math.min(45, v));
  };
  const fontSize = (() => {
    const n = Number(p.fontSize);
    if (!Number.isFinite(n)) return DEFAULT_SPEC.fontSize;
    return Math.max(10, Math.min(220, Math.round(n)));
  })();
  return {
    ratio: r.id,
    width: r.width,
    height: r.height,
    marginTopPct: clampPct(p.marginTopPct, DEFAULT_SPEC.marginTopPct),
    marginBottomPct: clampPct(p.marginBottomPct, DEFAULT_SPEC.marginBottomPct),
    marginLeftPct: clampPct(p.marginLeftPct, DEFAULT_SPEC.marginLeftPct),
    marginRightPct: clampPct(p.marginRightPct, DEFAULT_SPEC.marginRightPct),
    fontFamily: typeof p.fontFamily === 'string' ? p.fontFamily : DEFAULT_SPEC.fontFamily,
    fontSize,
    fontColor: typeof p.fontColor === 'string' ? p.fontColor : DEFAULT_SPEC.fontColor,
    textAlign:
      p.textAlign === 'center' || p.textAlign === 'right' ? p.textAlign : 'left',
    verticalAlign:
      p.verticalAlign === 'start' || p.verticalAlign === 'end' ? p.verticalAlign : 'center',
    bgFit: p.bgFit === 'contain' ? 'contain' : 'cover',
    bgFillColor: typeof p.bgFillColor === 'string' ? p.bgFillColor : DEFAULT_SPEC.bgFillColor,
    content: typeof p.content === 'string' ? p.content : '',
    offsetX: Number.isFinite(p.offsetX as number) ? Number(p.offsetX) : 0,
    offsetY: Number.isFinite(p.offsetY as number) ? Number(p.offsetY) : 0,
  };
}

export function wrapText(text: string, maxWidthPx: number, fontSizePx: number): string[] {
  const charW = Math.max(1, fontSizePx * 0.52);
  const maxChars = Math.max(1, Math.floor(maxWidthPx / charW));
  const out: string[] = [];
  for (const para of (text || '').split(/\r?\n/)) {
    if (!para) {
      out.push('');
      continue;
    }
    const words = para.split(/ +/);
    let cur = '';
    for (const w of words) {
      const trial = cur ? cur + ' ' + w : w;
      if (trial.length > maxChars) {
        if (cur) out.push(cur);
        if (w.length > maxChars) {
          let i = 0;
          while (i < w.length) {
            out.push(w.substring(i, i + maxChars));
            i += maxChars;
          }
          cur = '';
        } else {
          cur = w;
        }
      } else {
        cur = trial;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

const imageCache = new Map<string, HTMLImageElement>();

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('no image src'));
      return;
    }
    const cached = imageCache.get(src);
    if (cached && cached.complete && cached.naturalWidth > 0) {
      resolve(cached);
      return;
    }
    const img = new Image();
    // The backend file routes are served same-origin via the Next rewrite
    // (`/api/*` → backend), so `crossOrigin` is not needed and would break
    // cookie auth. Data URLs and same-origin assets work regardless.
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

/**
 * Target long edge for full-resolution exports (UHD-grade). Final downloads
 * and saved files always resolve to at least this many pixels on the longest
 * side so users get a UHD asset regardless of which platform aspect they pick.
 */
export const UHD_LONG_EDGE = 3840;

/** Compute the integer scale factor required to bring `spec` to >= UHD. */
export function uhdScale(spec: Pick<RenderSpec, 'width' | 'height'>): number {
  const long = Math.max(spec.width, spec.height);
  if (long <= 0) return 1;
  return Math.max(1, Math.ceil(UHD_LONG_EDGE / long));
}

/**
 * Multiply every pixel-domain field of a spec by `scale`. Margin percentages
 * are unit-less so they pass through unchanged — the layout therefore scales
 * uniformly and the rendered output is pixel-for-pixel identical (just at a
 * higher resolution).
 */
export function scaleSpec(spec: RenderSpec, scale: number): RenderSpec {
  if (scale === 1) return spec;
  return {
    ...spec,
    width: Math.round(spec.width * scale),
    height: Math.round(spec.height * scale),
    fontSize: Math.round(spec.fontSize * scale),
    offsetX: Math.round((spec.offsetX || 0) * scale),
    offsetY: Math.round((spec.offsetY || 0) * scale),
  };
}

export interface RenderOptions {
  /** Render at scale × the spec's native pixel size. Defaults to 1 (preview). */
  scale?: number;
}

/** Draw the spec to a canvas. Returns the canvas (caller can extract a blob). */
export async function renderToCanvas(
  baseSpec: RenderSpec,
  bgUrl: string | null,
  canvas: HTMLCanvasElement,
  opts: RenderOptions = {},
): Promise<HTMLCanvasElement> {
  const spec = scaleSpec(baseSpec, opts.scale && opts.scale > 1 ? opts.scale : 1);
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  // Background fill (visible only when bgFit === 'contain' or BG fails to load).
  ctx.fillStyle = spec.bgFillColor || '#000';
  ctx.fillRect(0, 0, spec.width, spec.height);

  if (bgUrl) {
    try {
      const img = await loadImage(bgUrl);
      const sw = img.naturalWidth;
      const sh = img.naturalHeight;
      const sr = sw / sh;
      const dr = spec.width / spec.height;
      let dx = 0,
        dy = 0,
        dw = spec.width,
        dh = spec.height;
      let sxBox = 0,
        syBox = 0,
        swBox = sw,
        shBox = sh;
      if (spec.bgFit === 'cover') {
        // Crop the source so the destination is fully covered.
        if (sr > dr) {
          // source is wider — crop sides
          swBox = sh * dr;
          sxBox = (sw - swBox) / 2;
        } else {
          shBox = sw / dr;
          syBox = (sh - shBox) / 2;
        }
      } else {
        // contain — letterbox into destination
        if (sr > dr) {
          dh = spec.width / sr;
          dy = (spec.height - dh) / 2;
        } else {
          dw = spec.height * sr;
          dx = (spec.width - dw) / 2;
        }
      }
      ctx.drawImage(img, sxBox, syBox, swBox, shBox, dx, dy, dw, dh);
    } catch {
      /* swallow — fill remains visible */
    }
  }

  // Text overlay.
  const ml = (spec.marginLeftPct / 100) * spec.width;
  const mr = (spec.marginRightPct / 100) * spec.width;
  const mt = (spec.marginTopPct / 100) * spec.height;
  const mb = (spec.marginBottomPct / 100) * spec.height;
  const innerW = Math.max(50, spec.width - ml - mr);
  const innerH = Math.max(50, spec.height - mt - mb);
  const lineHeight = Math.round(spec.fontSize * 1.32);
  const lines = wrapText(spec.content || '', innerW, spec.fontSize);
  const blockHeight = Math.max(spec.fontSize, lines.length * lineHeight);

  let baseY: number;
  if (spec.verticalAlign === 'start') baseY = mt + spec.fontSize;
  else if (spec.verticalAlign === 'end') baseY = spec.height - mb - blockHeight + spec.fontSize;
  else baseY = mt + (innerH - blockHeight) / 2 + spec.fontSize;
  baseY += spec.offsetY || 0;

  let x: number;
  let align: CanvasTextAlign;
  if (spec.textAlign === 'center') {
    align = 'center';
    x = ml + innerW / 2;
  } else if (spec.textAlign === 'right') {
    align = 'right';
    x = ml + innerW;
  } else {
    align = 'left';
    x = ml;
  }
  x += spec.offsetX || 0;

  ctx.fillStyle = spec.fontColor || '#FFFFFF';
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  const family = FONT_CSS[spec.fontFamily] || FONT_CSS.Inter;
  const weight = spec.fontFamily === 'Sans Bold' ? '800' : '600';
  ctx.font = `${weight} ${spec.fontSize}px ${family}`;

  let y = baseY;
  for (const line of lines) {
    ctx.fillText(line || ' ', x, y);
    y += lineHeight;
  }

  return canvas;
}

/** Convenience: render to a PNG data URL (used by demo store + downloads). */
export async function renderToDataUrl(
  spec: RenderSpec,
  bgUrl: string | null,
  opts: RenderOptions = {},
): Promise<string> {
  const canvas = document.createElement('canvas');
  await renderToCanvas(spec, bgUrl, canvas, opts);
  // PNG is lossless; toDataURL with image/png ignores any quality argument so
  // the output is bit-perfect at the rendered resolution.
  return canvas.toDataURL('image/png');
}

/** Trigger a browser download for an image URL or data URL. */
export function downloadDataUrl(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }, 0);
}
