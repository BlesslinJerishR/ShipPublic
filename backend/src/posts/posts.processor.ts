import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CommitsService } from '../commits/commits.service';
import { OllamaService } from '../ollama/ollama.service';
import { GalleryService } from '../gallery/gallery.service';
import { POSTS_QUEUE } from './posts.module';

interface GenerateJobData {
  postId: string;
  userId: string;
  projectId: string;
  shas: string[];
  platform: 'TWITTER' | 'LINKEDIN' | 'GENERIC';
  tone: string;
}

@Processor(POSTS_QUEUE, { concurrency: 1 })
export class PostsProcessor extends WorkerHost {
  private readonly logger = new Logger(PostsProcessor.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly commits: CommitsService,
    private readonly ollama: OllamaService,
    private readonly gallery: GalleryService,
  ) {
    super();
  }

  async process(job: Job<GenerateJobData>): Promise<void> {
    const { postId, userId, projectId, shas, platform, tone } = job.data;
    this.logger.log(`Generating post ${postId} for ${shas.length} commits`);
    try {
      // Fetch commit details with bounded concurrency. The previous version
      // awaited each call sequentially, which serialized up to 20 GitHub API
      // round-trips per post. We preserve the input order in the output.
      const limited = shas.slice(0, 20);
      const enriched: any[] = new Array(limited.length);
      const concurrency = 4;
      let cursor = 0;
      const worker = async () => {
        while (true) {
          const i = cursor++;
          if (i >= limited.length) return;
          const c = await this.commits.ensureCommitDetail(userId, projectId, limited[i]);
          enriched[i] = {
            sha: c.sha,
            message: c.message,
            author: c.authorName,
            authoredAt: c.authoredAt.toISOString(),
            additions: c.additions,
            deletions: c.deletions,
            filesChanged: c.filesChanged,
            diff: c.diffPreview ?? '',
          };
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, limited.length) }, () => worker()),
      );
      const summary = await this.ollama.summarizeCommits(enriched);
      const content = await this.ollama.polishToPost(summary, platform, tone);
      await this.prisma.post.update({
        where: { id: postId },
        data: {
          content: content.trim(),
          summary,
          metadata: { tone, generating: false, completedAt: new Date().toISOString() },
        },
      });
      // Auto-render the build-in-public image once the post body is ready.
      // Failures are swallowed inside the gallery service so the post still
      // succeeds even if rendering hits an issue (e.g. missing libvips).
      await this.gallery.autoGenerateForPost(userId, postId);
    } catch (err: any) {
      this.logger.error(`Post ${postId} generation failed: ${err?.message}`);
      await this.prisma.post.update({
        where: { id: postId },
        data: {
          status: 'FAILED',
          metadata: { error: String(err?.message ?? err), generating: false },
        },
      });
      throw err;
    }
  }
}
