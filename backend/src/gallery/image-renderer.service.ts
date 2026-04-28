/**
 * Server-side image renderer.
 *
 * Composites a background asset + the build-in-public post text into a PNG
 * using SVG and `sharp`. The same render spec is used by the frontend canvas
 * preview so the editor matches the saved output pixel-for-pixel (within the
 * limits of the shared word-wrapping heuristic).
 */

import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';

import { getRatio } from './ratios';

/**
 * Target long edge for full-resolution exports (UHD-grade). Saved files
 * always upscale to at least this many pixels on the longest side.
 */
export const UHD_LONG_EDGE = 3840;

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
  // Optional manual offsets in px for the editor's draggable text.
  offsetX?: number;
  offsetY?: number;
}

export interface RenderInput extends RenderSpec {
  bgPath: string;
}

export interface RenderResult {
  png: Buffer;
  width: number;
  height: number;
  spec: RenderSpec;
}

const SAFE_FONT_FAMILIES: Record<string, string> = {
  Inter: 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
  System: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  Serif: 'Georgia, "Times New Roman", serif',
  Mono: '"JetBrains Mono", Menlo, Consolas, monospace',
  'Sans Bold': 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Word-wrap a paragraph using a width estimate. Mirrors the client renderer
 * (`frontend/src/lib/gallery-render.ts`) so the editor preview matches.
 */
export function wrapText(text: string, maxWidthPx: number, fontSizePx: number): string[] {
  // Rough Inter sans-serif average glyph width factor; close enough for the
  // sub-pixel level of fidelity an indie social post needs.
  const charW = Math.max(1, fontSizePx * 0.52);
  const maxChars = Math.max(1, Math.floor(maxWidthPx / charW));
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
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

@Injectable()
export class ImageRendererService {
  private readonly logger = new Logger(ImageRendererService.name);

  /** Normalise + clamp a partial spec from any caller into a complete RenderSpec. */
  normaliseSpec(input: Partial<RenderSpec> & { ratio?: string }): RenderSpec {
    const ratio = getRatio(input.ratio || 'INSTAGRAM_PORTRAIT');
    const clampPct = (n: any, def: number) => {
      const v = typeof n === 'number' ? n : Number(n);
      if (!Number.isFinite(v)) return def;
      return Math.max(0, Math.min(45, v));
    };
    const fontSize = (() => {
      const n = Number(input.fontSize);
      if (!Number.isFinite(n)) return 48;
      return Math.max(10, Math.min(220, Math.round(n)));
    })();
    return {
      ratio: ratio.id,
      width: ratio.width,
      height: ratio.height,
      marginTopPct: clampPct(input.marginTopPct, 14),
      marginBottomPct: clampPct(input.marginBottomPct, 16),
      marginLeftPct: clampPct(input.marginLeftPct, 8),
      marginRightPct: clampPct(input.marginRightPct, 8),
      fontFamily: typeof input.fontFamily === 'string' ? input.fontFamily : 'Inter',
      fontSize,
      fontColor: typeof input.fontColor === 'string' ? input.fontColor : '#FFFFFF',
      textAlign: input.textAlign === 'center' || input.textAlign === 'right' ? input.textAlign : 'left',
      verticalAlign:
        input.verticalAlign === 'start' || input.verticalAlign === 'end' ? input.verticalAlign : 'center',
      bgFit: input.bgFit === 'contain' ? 'contain' : 'cover',
      bgFillColor: typeof input.bgFillColor === 'string' ? input.bgFillColor : '#1D1E21',
      content: typeof input.content === 'string' ? input.content : '',
      offsetX: Number.isFinite(input.offsetX as number) ? Number(input.offsetX) : 0,
      offsetY: Number.isFinite(input.offsetY as number) ? Number(input.offsetY) : 0,
    };
  }

  /**
   * Resize the BG to the canvas using `sharp` first (cover/contain) so the
   * SVG only has to overlay text on a perfectly-sized raster. This sidesteps
   * any preserveAspectRatio quirks across the librsvg backend that ships
   * inside `sharp`.
   */
  private async prepareBackground(spec: RenderSpec, bgPath: string): Promise<Buffer> {
    const buf = await fs.readFile(bgPath);
    const transformer = sharp(buf).resize({
      width: spec.width,
      height: spec.height,
      fit: spec.bgFit === 'contain' ? 'contain' : 'cover',
      position: 'centre',
      background: spec.bgFillColor,
    });
    return transformer.png().toBuffer();
  }

  private buildTextSvg(spec: RenderSpec): { svg: string; estimatedHeight: number } {
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
    if (spec.verticalAlign === 'start') {
      baseY = mt + spec.fontSize;
    } else if (spec.verticalAlign === 'end') {
      baseY = spec.height - mb - blockHeight + spec.fontSize;
    } else {
      baseY = mt + (innerH - blockHeight) / 2 + spec.fontSize;
    }
    baseY += spec.offsetY || 0;

    let anchor: 'start' | 'middle' | 'end' = 'start';
    let x: number;
    if (spec.textAlign === 'center') {
      anchor = 'middle';
      x = ml + innerW / 2;
    } else if (spec.textAlign === 'right') {
      anchor = 'end';
      x = ml + innerW;
    } else {
      anchor = 'start';
      x = ml;
    }
    x += spec.offsetX || 0;

    const family = SAFE_FONT_FAMILIES[spec.fontFamily] || SAFE_FONT_FAMILIES.Inter;
    const weight = spec.fontFamily === 'Sans Bold' ? 800 : 600;

    const tspans = lines
      .map((line, i) => {
        const dy = i === 0 ? 0 : lineHeight;
        const safe = escapeXml(line || ' ');
        return `<tspan x="${x}" dy="${dy}">${safe}</tspan>`;
      })
      .join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}">
  <text x="${x}" y="${baseY}" text-anchor="${anchor}" font-family='${family}' font-weight="${weight}" font-size="${spec.fontSize}" fill="${escapeXml(spec.fontColor)}" style="letter-spacing:-0.01em">${tspans}</text>
</svg>`;
    return { svg, estimatedHeight: blockHeight };
  }

  async render(input: RenderInput): Promise<RenderResult> {
    const baseSpec = this.normaliseSpec(input);

    // Final exports are always rendered at >= UHD on the longest edge so users
    // get a high-resolution PNG regardless of which platform aspect they pick.
    // Margin percentages are unit-less and pass through, so the layout scales
    // uniformly and looks identical to the editor preview \u2014 just larger.
    const long = Math.max(baseSpec.width, baseSpec.height);
    const scale = Math.max(1, Math.ceil(UHD_LONG_EDGE / Math.max(1, long)));
    const renderSpec: RenderSpec =
      scale === 1
        ? baseSpec
        : {
            ...baseSpec,
            width: baseSpec.width * scale,
            height: baseSpec.height * scale,
            fontSize: baseSpec.fontSize * scale,
            offsetX: (baseSpec.offsetX || 0) * scale,
            offsetY: (baseSpec.offsetY || 0) * scale,
          };

    const bgPng = await this.prepareBackground(renderSpec, input.bgPath);
    const { svg } = this.buildTextSvg(renderSpec);

    // PNG is lossless. `compressionLevel` only affects deflate work \u2014 it does
    // NOT degrade pixels \u2014 so we keep level 9 for smaller files at no quality\n    // cost. `palette: false` ensures full 24-bit color (no 256-colour quantise).
    const png = await sharp(bgPng)
      .composite([{ input: Buffer.from(svg, 'utf8'), top: 0, left: 0 }])
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
      .toBuffer();

    // Persist the canonical (1\u00d7) spec so the editor preview maths stay valid;
    // width/height in the result reflect the actual on-disk pixel dimensions.
    return { png, width: renderSpec.width, height: renderSpec.height, spec: baseSpec };
  }

  /** Resolve the absolute path of an asset on disk (or the bundled default). */
  resolveBgPath(storageDir: string, asset: { filename: string; isDefault?: boolean } | null): string {
    if (!asset) {
      return path.resolve(storageDir, 'defaults', 'blessl-bg.png');
    }
    if (asset.isDefault) {
      return path.resolve(storageDir, 'defaults', asset.filename);
    }
    return path.resolve(storageDir, 'assets', asset.filename);
  }
}
