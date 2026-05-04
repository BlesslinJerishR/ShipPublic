import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface CommitInput {
  sha: string;
  message: string;
  author?: string | null;
  authoredAt: string;
  additions: number;
  deletions: number;
  filesChanged: number;
  diff: string;
}

export type Platform = 'TWITTER' | 'LINKEDIN' | 'GENERIC';

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);

  private get baseUrl() {
    return process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  }
  private get coderModel() {
    return process.env.OLLAMA_CODER_MODEL || 'qwen2.5-coder:32b';
  }
  private get chatModel() {
    return process.env.OLLAMA_CHAT_MODEL || 'qwen3:32b';
  }

  async health(): Promise<{ ok: boolean; models: string[] }> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/api/tags`, { timeout: 5000 });
      const models: string[] = (data?.models || []).map((m: any) => m.name);
      return { ok: true, models };
    } catch (e: any) {
      this.logger.warn(`ollama health failed: ${e?.message}`);
      return { ok: false, models: [] };
    }
  }

  private async generate(model: string, prompt: string, system?: string): Promise<string> {
    try {
      const { data } = await axios.post(
        `${this.baseUrl}/api/generate`,
        {
          model,
          prompt,
          system,
          stream: false,
          options: { temperature: 0.4, num_ctx: 8192 },
        },
        { timeout: 1000 * 60 * 10 },
      );
      return String(data?.response ?? '').trim();
    } catch (err: any) {
      // Ollama returns 404 when the requested model is not pulled. Surface a
      // clearer message so the user knows to run `ollama pull <model>`.
      if (err?.response?.status === 404) {
        const detail = err?.response?.data?.error || `model "${model}" not found`;
        throw new Error(
          `Ollama: ${detail}. Pull it with: ollama pull ${model}`,
        );
      }
      throw err;
    }
  }

  async summarizeCommits(commits: CommitInput[]): Promise<string> {
    const compact = commits
      .map(
        (c) =>
          `COMMIT ${c.sha.substring(0, 7)} by ${c.author ?? 'unknown'} at ${c.authoredAt}\nMessage: ${c.message}\nFiles: ${c.filesChanged} +${c.additions} -${c.deletions}\nDiff:\n${c.diff || '(no diff)'}\n`,
      )
      .join('\n----\n');
    const prompt = `You are a senior developer reviewing recent git changes.

Analyze the commits and diffs below. Produce a structured technical summary in clean Markdown with these sections:
1. What changed (bulleted, concrete)
2. Why it likely matters (user impact / engineering value)
3. Notable technical details (libraries, patterns, refactors, fixes)
4. Suggested narrative angle for a build in public update (one paragraph)

Be precise and avoid filler. Do not invent features that are not in the diffs.

COMMITS:
${compact}`;
    return this.generate(
      this.coderModel,
      prompt,
      'You are a precise senior software engineer.',
    );
  }

  async polishToPost(
    summary: string,
    platform: Platform,
    tone: string = 'engaging but not cringe',
  ): Promise<string> {
    const constraints =
      platform === 'TWITTER'
        ? 'Write a single post under 280 characters. No hashtags spam. At most one hashtag.'
        : platform === 'LINKEDIN'
        ? 'Write a LinkedIn style post, 80 to 160 words, with a strong opening line, short paragraphs, and one closing question. No hashtags spam.'
        : 'Write a short build in public update, around 100 words, platform agnostic.';
    const prompt = `You are a developer writing a "build in public" update.

Tone: ${tone}. Plain language. First person. No corporate buzzwords. Do not use emojis. Do not start with "Excited to".

${constraints}

Use the structured summary below as ground truth. Do not invent features.

STRUCTURED SUMMARY:
${summary}

Return ONLY the final post text. No preamble, no explanations, no quotes.`;
    return this.generate(
      this.chatModel,
      prompt,
      'You write concise authentic developer updates.',
    );
  }

  // ---------------------------------------------------------------------------
  // AI News Gen pipeline
  //
  // Single-step: items → chat-polished social post.
  // The coder model has nothing to do here — there's no diff to read and
  // the headlines are already short, structured prose. Going straight from
  // items → chat keeps the pipeline ~2x faster and avoids drift between two
  // sequential LLM calls.
  // ---------------------------------------------------------------------------

  async polishToNewsPost(
    items: Array<{ title: string; snippet?: string | null; link: string; sourceName: string; publishedAt?: string | null }>,
    platform: Platform,
    tone: string = 'sharp solo-developer voice, no hype',
  ): Promise<string> {
    const compact = items
      .slice(0, 12)
      .map(
        (n, i) =>
          `[${i + 1}] (${n.sourceName}) ${n.title}${n.snippet ? `\n   ${n.snippet}` : ''}`,
      )
      .join('\n\n');
    const constraints =
      platform === 'TWITTER'
        ? 'One post, under 270 characters. Hook on line 1. At most one hashtag. No emojis.'
        : platform === 'LINKEDIN'
        ? 'LinkedIn post, 90 to 170 words. Strong opening line, short paragraphs, one closing question. No hashtags spam. No emojis.'
        : 'Short take, around 110 words. Plain language. No emojis.';
    const prompt = `You are a solo developer reacting to AI news for your audience.

Tone: ${tone}. First person. Plain, calm, technically literate. Explain it like a working engineer, not a VC. Do not start with "Excited to" or "BREAKING".

${constraints}

Use the items below as ground truth. Do not invent facts. If items disagree, prefer the most recent.

ITEMS:
${compact}

Return ONLY the final post text. No preamble, no quotes, no explanations.`;
    return this.generate(
      this.chatModel,
      prompt,
      'You write authentic, technically grounded social posts.',
    );
  }

  /**
   * Build a Stable Diffusion-friendly prompt for an editorial illustration
   * that represents the supplied headline / post text. Returns a single
   * line. Falls back to a sensible default if Ollama is unreachable so
   * pipelines never block on this step.
   */
  async imagePromptFor(headline: string): Promise<string> {
    const safe = (headline || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const fallback = `cinematic editorial illustration, dark moody background #000000, neon crimson #FF004F highlights, abstract tech motif inspired by: ${safe}, high contrast, 4k, no text, no watermark, no logo`;
    try {
      const out = await this.generate(
        this.chatModel,
        `Write ONE single-line Stable Diffusion prompt (under 60 words) for an editorial illustration that visually represents this:\n\n"${safe}"\n\nRules:\n- No text, no letters, no logos, no watermarks in the image\n- Pure black background (#000000) with crimson (#FF004F) and white accents\n- Cinematic, editorial, high contrast\n- Return ONLY the prompt text, no preface, no quotes\n`,
        'You write concise Stable Diffusion prompts.',
      );
      const line = out.split('\n').find((l) => l.trim().length > 0)?.trim() || fallback;
      // Hard guard: keep the colour direction even if the model drifted.
      if (!/black|dark/i.test(line)) return `${line}, dark background`;
      return line.slice(0, 600);
    } catch {
      return fallback;
    }
  }

  /** Backwards-compatible alias used by older call sites. */
  async newsImagePrompt(headline: string): Promise<string> {
    return this.imagePromptFor(headline);
  }
}
