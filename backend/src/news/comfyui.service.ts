/**
 * Optional ComfyUI integration. When `COMFYUI_BASE_URL` is set in env,
 * NewsProcessor will use this service to render an AI background for the
 * news post. When unset, the call is a no-op and the gallery falls back to
 * the user's default background asset.
 *
 * Workflow used: a minimal SDXL text2img graph with a CheckpointLoader,
 * positive/negative CLIPTextEncode, EmptyLatentImage, KSampler, VAEDecode,
 * and SaveImage. The chosen checkpoint, dimensions, and steps are env-tunable
 * so the same code path serves SD 1.5 setups (lower VRAM) as well as SDXL.
 */

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { randomBytes } from 'node:crypto';

@Injectable()
export class ComfyUIService {
  private readonly logger = new Logger(ComfyUIService.name);

  get baseUrl(): string {
    return (process.env.COMFYUI_BASE_URL || '').replace(/\/$/, '');
  }
  get available(): boolean {
    return !!this.baseUrl;
  }
  private get model(): string {
    return process.env.COMFYUI_MODEL || 'sd_xl_base_1.0.safetensors';
  }
  private get steps(): number {
    return Math.max(4, Math.min(60, Number(process.env.COMFYUI_STEPS || 24)));
  }
  private get width(): number {
    return Math.max(256, Math.min(2048, Number(process.env.COMFYUI_WIDTH || 1024)));
  }
  private get height(): number {
    return Math.max(256, Math.min(2048, Number(process.env.COMFYUI_HEIGHT || 1280)));
  }

  /**
   * Submit a prompt + poll history until the image is available, then
   * download the PNG bytes. Times out after ~3 minutes by default.
   * Returns null on any failure so the caller can fall back gracefully.
   */
  async generateBackground(prompt: string): Promise<{ data: Buffer; mime: string } | null> {
    if (!this.available) return null;
    const timeoutMs = Number(process.env.COMFYUI_TIMEOUT_MS || 3 * 60_000);
    const negative =
      'text, watermark, logo, signature, ugly, blurry, lowres, deformed, jpeg artifacts';
    const seed = Math.floor(Math.random() * 1e15);
    const clientId = randomBytes(8).toString('hex');

    const workflow = this.buildWorkflow({
      positive: prompt,
      negative,
      seed,
      width: this.width,
      height: this.height,
      steps: this.steps,
      ckpt: this.model,
    });

    try {
      const submit = await axios.post(
        `${this.baseUrl}/prompt`,
        { prompt: workflow, client_id: clientId },
        { timeout: 15_000 },
      );
      const promptId = submit.data?.prompt_id;
      if (!promptId) {
        this.logger.warn('ComfyUI: no prompt_id in submit response');
        return null;
      }

      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 1500));
        const { data } = await axios.get(`${this.baseUrl}/history/${promptId}`, {
          timeout: 10_000,
        });
        const entry = data?.[promptId];
        if (!entry) continue;
        const outputs = entry?.outputs || {};
        for (const nodeOut of Object.values<any>(outputs)) {
          const images: any[] = nodeOut?.images || [];
          if (images.length) {
            const img = images[0];
            const file = await axios.get(`${this.baseUrl}/view`, {
              params: { filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' },
              responseType: 'arraybuffer',
              timeout: 30_000,
            });
            return {
              data: Buffer.from(file.data),
              mime: 'image/png',
            };
          }
        }
      }
      this.logger.warn(`ComfyUI: timed out waiting for prompt ${promptId}`);
      return null;
    } catch (err: any) {
      this.logger.warn(`ComfyUI generation failed: ${err?.message || err}`);
      return null;
    }
  }

  private buildWorkflow(opts: {
    positive: string;
    negative: string;
    seed: number;
    width: number;
    height: number;
    steps: number;
    ckpt: string;
  }) {
    return {
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: opts.ckpt },
      },
      '5': {
        class_type: 'EmptyLatentImage',
        inputs: { width: opts.width, height: opts.height, batch_size: 1 },
      },
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: opts.positive, clip: ['4', 1] },
      },
      '7': {
        class_type: 'CLIPTextEncode',
        inputs: { text: opts.negative, clip: ['4', 1] },
      },
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: opts.seed,
          steps: opts.steps,
          cfg: 6.5,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: ['5', 0],
        },
      },
      '8': {
        class_type: 'VAEDecode',
        inputs: { samples: ['3', 0], vae: ['4', 2] },
      },
      '9': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: 'shipublic_news', images: ['8', 0] },
      },
    };
  }
}
