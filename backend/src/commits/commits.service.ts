import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GithubService } from '../github/github.service';

@Injectable()
export class CommitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubService,
  ) {}

  async syncRange(
    userId: string,
    projectId: string,
    opts: { since?: string; until?: string; perPage?: number; page?: number; branch?: string } = {},
  ) {
    // Issue both lookups in parallel; they're independent.
    const [project, user] = await Promise.all([
      this.prisma.project.findFirst({ where: { id: projectId, userId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);
    if (!project) throw new NotFoundException('project');
    if (!user) throw new NotFoundException('user');

    const list = await this.github.listCommits(user.accessToken, project.owner, project.name, {
      since: opts.since,
      until: opts.until,
      perPage: opts.perPage ?? 50,
      page: opts.page ?? 1,
      sha: opts.branch,
    });

    if (!list.length) {
      await this.prisma.project.update({
        where: { id: project.id },
        data: { lastSyncedAt: new Date() },
      });
      return { synced: 0 };
    }

    // Run all upserts inside a single interactive transaction so the writes
    // share one connection round-trip and a single commit. Previously this
    // was a sequential await-in-loop, which serialized N round-trips.
    const ops = list.map((c) =>
      this.prisma.commit.upsert({
        where: { projectId_sha: { projectId: project.id, sha: c.sha } },
        create: {
          projectId: project.id,
          sha: c.sha,
          message: c.message,
          authorName: c.authorName ?? undefined,
          authorEmail: c.authorEmail ?? undefined,
          authoredAt: new Date(c.authoredAt),
          url: c.url,
        },
        update: {
          message: c.message,
          authorName: c.authorName ?? undefined,
          authorEmail: c.authorEmail ?? undefined,
          authoredAt: new Date(c.authoredAt),
          url: c.url,
        },
      }),
    );
    const written = await this.prisma.$transaction(ops);

    await this.prisma.project.update({
      where: { id: project.id },
      data: { lastSyncedAt: new Date() },
    });
    return { synced: written.length };
  }

  async listCommits(
    userId: string,
    projectId: string,
    opts: { from?: string; to?: string; take?: number; cursor?: string } = {},
  ) {
    // Verify ownership via a lightweight count instead of fetching the row.
    const owns = await this.prisma.project.count({ where: { id: projectId, userId } });
    if (!owns) throw new NotFoundException('project');

    const where: Prisma.CommitWhereInput = { projectId };
    if (opts.from || opts.to) {
      where.authoredAt = {};
      if (opts.from) (where.authoredAt as any).gte = new Date(opts.from);
      if (opts.to) (where.authoredAt as any).lte = new Date(opts.to);
    }
    return this.prisma.commit.findMany({
      where,
      orderBy: { authoredAt: 'desc' },
      take: Math.min(opts.take ?? 100, 200),
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    });
  }

  async getDailyAggregates(userId: string, projectId: string, from?: string, to?: string) {
    const owns = await this.prisma.project.count({ where: { id: projectId, userId } });
    if (!owns) throw new NotFoundException('project');

    // Push the GROUP BY into Postgres instead of streaming every row to Node.
    // This dramatically reduces network bytes and JS object allocation when
    // a project has thousands of commits.
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    const rows = await this.prisma.$queryRaw<{ date: string; count: bigint }[]>(
      Prisma.sql`
        SELECT TO_CHAR("authoredAt"::date, 'YYYY-MM-DD') AS date,
               COUNT(*)::bigint AS count
        FROM "Commit"
        WHERE "projectId" = ${projectId}
          AND (${fromDate}::timestamp IS NULL OR "authoredAt" >= ${fromDate})
          AND (${toDate}::timestamp IS NULL OR "authoredAt" <= ${toDate})
        GROUP BY 1
        ORDER BY 1
      `,
    );
    return rows.map((r) => ({ date: r.date, count: Number(r.count) }));
  }

  async ensureCommitDetail(userId: string, projectId: string, sha: string) {
    const [user, project] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.project.findFirst({ where: { id: projectId, userId } }),
    ]);
    if (!user || !project) throw new NotFoundException();
    const existing = await this.prisma.commit.findUnique({
      where: { projectId_sha: { projectId: project.id, sha } },
    });
    if (existing && existing.diffPreview) return existing;
    let detail: Awaited<ReturnType<typeof this.github.getCommitDetail>>;
    try {
      detail = await this.github.getCommitDetail(user.accessToken, project.owner, project.name, sha);
    } catch (err: any) {
      // GitHub returns 404 when the SHA no longer exists (force-push, rebase, etc.).
      // Fall back to whatever is already stored so post generation can proceed.
      if (err?.status === 404 && existing) return existing;
      throw err;
    }
    return this.prisma.commit.upsert({
      where: { projectId_sha: { projectId: project.id, sha: detail.sha } },
      create: {
        projectId: project.id,
        sha: detail.sha,
        message: detail.message,
        authorName: detail.authorName ?? undefined,
        authorEmail: detail.authorEmail ?? undefined,
        authoredAt: new Date(detail.authoredAt),
        url: detail.url,
        additions: detail.additions,
        deletions: detail.deletions,
        filesChanged: detail.filesChanged,
        diffPreview: detail.diff,
      },
      update: {
        additions: detail.additions,
        deletions: detail.deletions,
        filesChanged: detail.filesChanged,
        diffPreview: detail.diff,
      },
    });
  }
}
