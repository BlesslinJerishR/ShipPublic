/**
 * Gallery service — owns the lifecycle of background assets, generated post
 * images, and per-user gallery defaults.
 *
 * Storage layout (under STORAGE_DIR):
 *   defaults/   bundled images shipped with the app (read-only)
 *   assets/     user-uploaded background images
 *   images/     rendered post images
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

import { PrismaService } from '../prisma/prisma.service';
import {
  ImageRendererService,
  RenderSpec,
} from './image-renderer.service';
import { getRatio, recommendedRatioFor } from './ratios';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export interface UploadAssetInput {
  name: string;
  mimeType: string;
  base64: string; // raw base64 (no data: prefix) or full data URL
}

export interface GenerateImageInput {
  postId: string;
  assetId?: string | null;
  ratio?: string;
  marginTopPct?: number;
  marginBottomPct?: number;
  marginLeftPct?: number;
  marginRightPct?: number;
  fontFamily?: string;
  fontSize?: number;
  fontColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'start' | 'center' | 'end';
  bgFit?: 'cover' | 'contain';
  bgFillColor?: string;
  content?: string; // override; defaults to post.content
  offsetX?: number;
  offsetY?: number;
}

@Injectable()
export class GalleryService implements OnModuleInit {
  private readonly logger = new Logger(GalleryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: ImageRendererService,
  ) {}

  get storageDir(): string {
    return path.resolve(process.env.STORAGE_DIR || './storage');
  }

  get maxUploadBytes(): number {
    const n = Number(process.env.GALLERY_UPLOAD_MAX_BYTES || 8 * 1024 * 1024);
    return Number.isFinite(n) && n > 0 ? n : 8 * 1024 * 1024;
  }

  async onModuleInit() {
    // Best-effort directory bootstrap. Failures are logged but don't crash the
    // app — file ops will surface a clearer error to the API caller.
    for (const sub of ['defaults', 'assets', 'images']) {
      try {
        await fs.mkdir(path.join(this.storageDir, sub), { recursive: true });
      } catch (e: any) {
        this.logger.warn(`Could not ensure ${sub} dir: ${e?.message}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  async getSettings(userId: string) {
    let s = await this.prisma.gallerySettings.findUnique({ where: { userId } });
    if (!s) {
      s = await this.prisma.gallerySettings.create({ data: { userId } });
    }
    return s;
  }

  async updateSettings(
    userId: string,
    patch: Partial<Omit<Awaited<ReturnType<GalleryService['getSettings']>>, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>,
  ) {
    const current = await this.getSettings(userId);
    if (patch.defaultAssetId) {
      const exists = await this.prisma.galleryAsset.findFirst({
        where: { id: patch.defaultAssetId, userId },
      });
      if (!exists) throw new BadRequestException('defaultAssetId not found');
    }
    return this.prisma.gallerySettings.update({
      where: { id: current.id },
      data: patch as any,
    });
  }

  // -------------------------------------------------------------------------
  // Assets
  // -------------------------------------------------------------------------

  async listAssets(userId: string) {
    return this.prisma.galleryAsset.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAsset(userId: string, id: string) {
    const a = await this.prisma.galleryAsset.findFirst({ where: { id, userId } });
    if (!a) throw new NotFoundException('asset');
    return a;
  }

  async uploadAsset(userId: string, input: UploadAssetInput) {
    if (!input?.base64) throw new BadRequestException('base64 required');
    const raw = String(input.base64).replace(/^data:[^;]+;base64,/, '');
    let buf: Buffer;
    try {
      buf = Buffer.from(raw, 'base64');
    } catch {
      throw new BadRequestException('invalid base64');
    }
    if (!buf.length) throw new BadRequestException('empty file');
    if (buf.length > this.maxUploadBytes) {
      throw new BadRequestException(`file too large (max ${this.maxUploadBytes} bytes)`);
    }
    const mime = (input.mimeType || 'image/png').toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      throw new BadRequestException(`unsupported mime ${mime}`);
    }
    let meta: sharp.Metadata;
    try {
      meta = await sharp(buf).metadata();
    } catch {
      throw new BadRequestException('not a valid image');
    }
    if (!meta.width || !meta.height) {
      throw new BadRequestException('image has no dimensions');
    }

    const id = `ga_${randomBytes(8).toString('hex')}`;
    const ext = EXT_BY_MIME[mime];
    const filename = `${id}.${ext}`;
    const abs = path.join(this.storageDir, 'assets', filename);
    await fs.writeFile(abs, buf);

    const asset = await this.prisma.galleryAsset.create({
      data: {
        id,
        userId,
        name: input.name?.slice(0, 120) || 'background',
        mimeType: mime,
        width: meta.width,
        height: meta.height,
        sizeBytes: buf.length,
        filename,
      },
    });

    // First upload becomes the user's default automatically.
    const settings = await this.getSettings(userId);
    if (!settings.defaultAssetId) {
      await this.prisma.gallerySettings.update({
        where: { id: settings.id },
        data: { defaultAssetId: asset.id },
      });
    }
    return asset;
  }

  async deleteAsset(userId: string, id: string) {
    const a = await this.getAsset(userId, id);
    if (a.isDefault) throw new BadRequestException('cannot delete bundled default');
    const abs = path.join(this.storageDir, 'assets', a.filename);
    await this.prisma.galleryAsset.delete({ where: { id } });
    try {
      await fs.unlink(abs);
    } catch {
      /* file may already be gone, ignore */
    }
    // Clear defaultAssetId on settings if it pointed here.
    const s = await this.prisma.gallerySettings.findUnique({ where: { userId } });
    if (s?.defaultAssetId === id) {
      await this.prisma.gallerySettings.update({
        where: { id: s.id },
        data: { defaultAssetId: null },
      });
    }
    return { ok: true };
  }

  async readAssetBytes(userId: string, id: string): Promise<{ data: Buffer; mime: string }> {
    const a = await this.getAsset(userId, id);
    const abs = path.join(this.storageDir, 'assets', a.filename);
    const data = await fs.readFile(abs);
    return { data, mime: a.mimeType };
  }

  // -------------------------------------------------------------------------
  // Images
  // -------------------------------------------------------------------------

  async listImages(userId: string, opts: { postId?: string } = {}) {
    return this.prisma.galleryImage.findMany({
      where: {
        userId,
        ...(opts.postId ? { postId: opts.postId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async getImage(userId: string, id: string) {
    const img = await this.prisma.galleryImage.findFirst({ where: { id, userId } });
    if (!img) throw new NotFoundException('image');
    return img;
  }

  async readImageBytes(userId: string, id: string) {
    const img = await this.getImage(userId, id);
    const abs = path.join(this.storageDir, 'images', img.filename);
    const data = await fs.readFile(abs);
    return { data, mime: img.mimeType };
  }

  async deleteImage(userId: string, id: string) {
    const img = await this.getImage(userId, id);
    const abs = path.join(this.storageDir, 'images', img.filename);
    await this.prisma.galleryImage.delete({ where: { id } });
    try {
      await fs.unlink(abs);
    } catch {
      /* ignore */
    }
    return { ok: true };
  }

  /**
   * Build a fully-resolved RenderSpec for a post by merging the user's
   * default settings, the post's existing render spec (if any), and the
   * caller's overrides — in that order.
   */
  private async buildSpecFor(
    userId: string,
    post: { id: string; content: string; platform: string },
    overrides: Omit<GenerateImageInput, 'postId'>,
  ): Promise<{ spec: RenderSpec; assetId: string | null; bgPath: string }> {
    const settings = await this.getSettings(userId);

    // Resolve background asset.
    let assetId: string | null = overrides.assetId ?? settings.defaultAssetId ?? null;
    let assetRow: { filename: string; isDefault: boolean } | null = null;
    if (assetId) {
      const a = await this.prisma.galleryAsset.findFirst({
        where: { id: assetId, userId },
      });
      if (a) {
        assetRow = { filename: a.filename, isDefault: a.isDefault };
      } else {
        assetId = null;
      }
    }
    const bgPath = this.renderer.resolveBgPath(this.storageDir, assetRow);

    // Fall back to platform-specific recommendation when no explicit ratio.
    const ratio =
      overrides.ratio ||
      settings.defaultRatio ||
      recommendedRatioFor(post.platform as any);
    const r = getRatio(ratio);

    const spec = this.renderer.normaliseSpec({
      ratio: r.id,
      marginTopPct: overrides.marginTopPct ?? settings.marginTopPct,
      marginBottomPct: overrides.marginBottomPct ?? settings.marginBottomPct,
      marginLeftPct: overrides.marginLeftPct ?? settings.marginLeftPct,
      marginRightPct: overrides.marginRightPct ?? settings.marginRightPct,
      fontFamily: overrides.fontFamily ?? settings.fontFamily,
      fontSize: overrides.fontSize ?? settings.fontSize,
      fontColor: overrides.fontColor ?? settings.fontColor,
      textAlign: (overrides.textAlign ?? settings.textAlign) as any,
      verticalAlign: (overrides.verticalAlign ?? settings.verticalAlign) as any,
      bgFit: (overrides.bgFit ?? settings.bgFit) as any,
      bgFillColor: overrides.bgFillColor ?? settings.bgFillColor,
      content: overrides.content ?? post.content ?? '',
      offsetX: overrides.offsetX,
      offsetY: overrides.offsetY,
    });

    return { spec, assetId, bgPath };
  }

  /** Render a fresh image for a post. Stores PNG to disk + DB row. */
  async generateForPost(userId: string, input: GenerateImageInput) {
    if (!input?.postId) throw new BadRequestException('postId required');
    const post = await this.prisma.post.findFirst({
      where: { id: input.postId, userId },
    });
    if (!post) throw new NotFoundException('post');
    if (!post.content?.trim() && !input.content?.trim()) {
      throw new BadRequestException('post has no content yet');
    }

    const { spec, assetId, bgPath } = await this.buildSpecFor(userId, post, input);

    const id = `gi_${randomBytes(8).toString('hex')}`;
    const filename = `${id}.png`;
    const abs = path.join(this.storageDir, 'images', filename);
    try {
      const result = await this.renderer.render({ ...spec, bgPath });
      await fs.writeFile(abs, result.png);
      const row = await this.prisma.galleryImage.create({
        data: {
          id,
          userId,
          postId: post.id,
          assetId,
          filename,
          mimeType: 'image/png',
          width: result.width,
          height: result.height,
          sizeBytes: result.png.length,
          spec: spec as any,
          status: 'READY',
        },
      });
      return row;
    } catch (err: any) {
      this.logger.error(`generate failed: ${err?.message}`);
      const row = await this.prisma.galleryImage.create({
        data: {
          id,
          userId,
          postId: post.id,
          assetId,
          filename,
          mimeType: 'image/png',
          width: spec.width,
          height: spec.height,
          sizeBytes: 0,
          spec: spec as any,
          status: 'FAILED',
        },
      });
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  /** Re-render an existing image with edits (overwrites the PNG in place). */
  async updateImage(
    userId: string,
    id: string,
    patch: Omit<GenerateImageInput, 'postId'>,
  ) {
    const img = await this.getImage(userId, id);
    if (!img.postId) throw new BadRequestException('image is not linked to a post');
    const post = await this.prisma.post.findFirst({
      where: { id: img.postId, userId },
    });
    if (!post) throw new NotFoundException('post');

    // Merge prior spec with the patch so the editor only needs to send deltas.
    const prior = (img.spec || {}) as Partial<RenderSpec>;
    const merged: Omit<GenerateImageInput, 'postId'> = {
      assetId: patch.assetId !== undefined ? patch.assetId : img.assetId,
      ratio: patch.ratio ?? prior.ratio,
      marginTopPct: patch.marginTopPct ?? prior.marginTopPct,
      marginBottomPct: patch.marginBottomPct ?? prior.marginBottomPct,
      marginLeftPct: patch.marginLeftPct ?? prior.marginLeftPct,
      marginRightPct: patch.marginRightPct ?? prior.marginRightPct,
      fontFamily: patch.fontFamily ?? prior.fontFamily,
      fontSize: patch.fontSize ?? prior.fontSize,
      fontColor: patch.fontColor ?? prior.fontColor,
      textAlign: (patch.textAlign ?? prior.textAlign) as any,
      verticalAlign: (patch.verticalAlign ?? prior.verticalAlign) as any,
      bgFit: (patch.bgFit ?? prior.bgFit) as any,
      bgFillColor: patch.bgFillColor ?? prior.bgFillColor,
      content: patch.content ?? prior.content,
      offsetX: patch.offsetX ?? prior.offsetX,
      offsetY: patch.offsetY ?? prior.offsetY,
    };
    const { spec, assetId, bgPath } = await this.buildSpecFor(userId, post, merged);

    const result = await this.renderer.render({ ...spec, bgPath });
    const abs = path.join(this.storageDir, 'images', img.filename);
    await fs.writeFile(abs, result.png);

    return this.prisma.galleryImage.update({
      where: { id: img.id },
      data: {
        assetId,
        width: result.width,
        height: result.height,
        sizeBytes: result.png.length,
        spec: spec as any,
        status: 'READY',
      },
    });
  }

  /**
   * Used by the posts BullMQ worker to auto-generate an image when a post's
   * content is freshly polished. Honours the user's autoGenerate flag and
   * never throws — image generation must not fail the post pipeline.
   */
  async autoGenerateForPost(userId: string, postId: string): Promise<void> {
    try {
      const settings = await this.getSettings(userId);
      if (!settings.autoGenerate) return;
      await this.generateForPost(userId, { postId });
    } catch (err: any) {
      this.logger.warn(`auto-generate skipped for post ${postId}: ${err?.message}`);
    }
  }
}
