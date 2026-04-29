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
  // ---------------------------------------------------------------------------

  async summarizeNews(
    items: Array<{ title: string; snippet?: string | null; link: string; sourceName: string; publishedAt?: string | null }>,
  ): Promise<string> {
    const compact = items
      .slice(0, 12)
      .map(
        (n, i) =>
          `[${i + 1}] (${n.sourceName}) ${n.title}\n   ${n.snippet || ''}\n   url: ${n.link}${n.publishedAt ? ` (published ${n.publishedAt})` : ''}`,
      )
      .join('\n\n');
    const prompt = `You are an AI news editor for a solo developer's "build in public" channel.

Read the news items below. Produce a structured Markdown brief:
1. The single most newsworthy angle (one sentence)
2. Key facts (3 to 5 bullets, concrete and dated where known)
3. Why this matters for solo developers / indie hackers (one paragraph)
4. Suggested narrative hook for a short social post (one sentence)

Be precise. Do not invent. If items disagree, prefer the most recent.

NEWS:
${compact}`;
    return this.generate(
      this.coderModel,
      prompt,
      'You are a precise tech news editor.',
    );
  }

  async polishToNewsPost(
    summary: string,
    platform: Platform,
    tone: string = 'sharp solo-developer voice, no hype',
  ): Promise<string> {
    const constraints =
      platform === 'TWITTER'
        ? 'One post, under 270 characters. Hook on line 1. At most one hashtag. No emojis.'
        : platform === 'LINKEDIN'
        ? 'LinkedIn post, 90 to 170 words. Strong opening line, short paragraphs, one closing question. No hashtags spam. No emojis.'
        : 'Short take, around 110 words. Plain language. No emojis.';
    const prompt = `You are a solo developer reacting to AI news for your audience.

Tone: ${tone}. First person. Plain, calm, technically literate. Explain it like a working engineer, not a VC. Do not start with "Excited to" or "BREAKING".

${constraints}

Use the brief below as ground truth. Do not invent facts.

BRIEF:
${summary}

Return ONLY the final post text. No preamble, no quotes, no explanations.`;
    return this.generate(
      this.chatModel,
      prompt,
      'You write authentic, technically grounded social posts.',
    );
  }

  /**
   * Build a Stable Diffusion-friendly prompt for the news post background.
   * Returns a single line. Falls back to a sensible default if Ollama is
   * unreachable so the news pipeline never blocks on this step.
   */
  async newsImagePrompt(headline: string): Promise<string> {
    const fallback = `cinematic editorial illustration, dark moody background #1D1E21, neon crimson #FF004F highlights, abstract tech motif inspired by: ${headline}, high contrast, 4k, no text, no watermark, no logo`;
    try {
      const out = await this.generate(
        this.chatModel,
        `Write ONE single-line Stable Diffusion prompt (under 60 words) for an editorial illustration that visually represents this AI news headline.\n\nHeadline: "${headline}"\n\nRules:\n- No text, no letters, no logos, no watermarks in the image\n- Pure black background (#1D1E21) with crimson (#FF004F) and white accents\n- Cinematic, editorial, high contrast\n- Return ONLY the prompt text, no preface, no quotes\n`,
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
}
