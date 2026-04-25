# Shipublic

> **Your `.git` history, automatically turned into ship-worthy "build in public" updates — entirely on your own machine.**

Shipublic is a fully local, AGPL-licensed automation tool that watches your
GitHub repositories, reads commit messages **and the actual code diffs**, and
uses a two-stage local LLM pipeline to produce clean, engaging,
ready-to-publish posts for Twitter, LinkedIn, and generic broadcast.

No SaaS lock-in. No third-party API costs. No telemetry. Just `git` →
`Ollama` → `Postgres` → `you`.

---

## Table of Contents

1. [The Idea](#1-the-idea)
2. [Who It's For](#2-who-its-for)
3. [Feature Matrix](#3-feature-matrix)
4. [System Architecture](#4-system-architecture)
5. [End-to-End Data Flow](#5-end-to-end-data-flow)
6. [Tech Stack](#6-tech-stack)
7. [Repository Layout](#7-repository-layout)
8. [Data Model](#8-data-model)
9. [API Surface](#9-api-surface)
10. [Background Jobs & Queues](#10-background-jobs--queues)
11. [LLM Pipeline](#11-llm-pipeline)
12. [Frontend Architecture](#12-frontend-architecture)
13. [Demo Mode](#13-demo-mode)
14. [Performance Optimizations](#14-performance-optimizations)
15. [Benchmarks & Numbers](#15-benchmarks--numbers)
16. [Security](#16-security)
17. [Local Development](#17-local-development)
18. [Production Deployment](#18-production-deployment)
19. [Configuration Reference](#19-configuration-reference)
20. [Comparison vs Alternatives](#20-comparison-vs-alternatives)
21. [Roadmap](#21-roadmap)
22. [License](#22-license)

---

## 1. The Idea

Most developers ship in silence. They land features, fix bugs, refactor
infrastructure, and never write about any of it — either because the cost
of writing a good update is high, or because changelogs read like
`fixed bug, added feature` and nobody clicks through.

Shipublic closes that loop:

```
git push
   │
   ▼
GitHub webhook  ───▶  Shipublic backend
                         │
                         ├─ pulls commits + unified diffs
                         ├─ qwen2.5-coder:32b   (engineering brain)
                         │     └─ structured technical summary
                         ├─ qwen3:32b           (writer's voice)
                         │     └─ short, story-style social post
                         └─ posts.metadata.generating = false
                                       │
                                       ▼
                            /dashboard/posts/[id]   (you publish)
```

**One-line value:** *Turn your commits into content without lifting a
finger.*

What makes this different from every other "AI post writer":

- It reads **diffs**, not just commit subjects, so it understands *what
  actually changed in the code*.
- It runs **completely offline** through [Ollama][ollama]; your code never
  leaves your machine.
- It uses a **two-model pipeline** (coder model → chat model) so the
  technical understanding and the prose voice are decoupled.
- It is **Git-native**: webhooks make the workflow zero-touch once
  Auto Sync is on.

---

## 2. Who It's For

| Persona | Why they care |
| --- | --- |
| Indie hackers building in public | Consistent posting without context-switching out of the IDE. |
| Developers who hate writing posts | The hardest part (the first draft) is done before you sit down. |
| Founders documenting progress | A historical record of *what* shipped and *when*, by repo. |
| Open-source maintainers | Auto-generated release notes in human voice, not bullet soup. |

---

## 3. Feature Matrix

| Area | Capability |
| --- | --- |
| Auth | GitHub OAuth (cookie session, JWT inside, `httpOnly`, `sameSite=lax`). |
| Project linking | Pick any repo you can access (owner / collab / org). One-click add. |
| Commit ingestion | Manual sync (date-range or `perPage`) and webhook-driven Auto Sync. |
| Commit browsing | Date-range filter, multi-select, range-select, pagination via Prisma cursor. |
| Diff understanding | Per-commit file diffs fetched via `GET /repos/:o/:r/commits/:sha`, capped at 12 KB and stored. |
| Post generation | Twitter / LinkedIn / Generic, configurable tone, custom signature line. |
| Post lifecycle | Draft → Scheduled → Published → (Failed); edit, copy, re-generate. |
| Calendar | One GitHub-style 365-day contributions heatmap (per project) and one posts calendar (across all projects). |
| Theming | Light / Dark with FOUC-free synchronous bootstrap; brand palette `#1D1E21`, `#FFFFFF`, `#FF004F`. |
| Demo mode | Standalone read-only experience with seeded mock data, no backend required. |
| Webhooks | HMAC-SHA256 signature verified in constant time against the raw request body. |
| Background work | Post generation runs in a BullMQ worker so HTTP requests stay snappy. |

---

## 4. System Architecture

```
                    ┌────────────────────────┐
                    │  Browser (Next.js 15)  │
                    │  React 19 + CSS Mod.   │
                    │  useApi SWR-lite cache │
                    └──────────┬─────────────┘
                       /api/*  │  (Next rewrites)
                               ▼
                    ┌────────────────────────┐
   GitHub OAuth ◀──▶│  NestJS 11 (Fastify)   │◀────┐
                    │  helmet, compress,     │     │
                    │  cookie-jwt, rawBody   │     │
                    └────┬─────────────┬─────┘     │
                         │             │           │
                         ▼             ▼           │
                  ┌────────────┐ ┌──────────┐      │
                  │ Prisma 6   │ │ BullMQ   │      │
                  │ Postgres17 │ │ Redis 7  │      │
                  └────────────┘ └────┬─────┘      │
                                      │            │
                                      ▼            │
                              ┌──────────────┐     │
                              │ Worker       │─────┤
                              │ PostsProcess │     │
                              └──────┬───────┘     │
                                     │             │
                                     ▼             │
                              ┌──────────────┐     │
                              │ Ollama HTTP  │     │
                              │ qwen2.5-cod. │     │
                              │ qwen3:32b    │     │
                              └──────────────┘     │
                                                   │
   GitHub Webhook (push)  ────── HMAC verify  ─────┘
```

### Process boundaries

- **Frontend** (`frontend/`): a Next.js App Router app. All `/api/*`
  requests are rewritten to the backend (`NEXT_PUBLIC_API_URL`).
- **Backend** (`backend/`): a single NestJS process on Fastify. The
  BullMQ worker lives **in-process** today; split it out for horizontal
  scaling.
- **Postgres**: source of truth for users, projects, commits, posts.
- **Redis**: BullMQ queue. App-level caches (Octokit per token, JWT user,
  contribution calendar) currently live in the Node process.
- **Ollama**: separate local daemon at `http://localhost:11434`.

---

## 5. End-to-End Data Flow

### 5.1 Login

```
User → GET /                                         (Next landing)
     → click "Continue with GitHub"
     → GET /api/auth/github                          (302 to GitHub)
     → GET /api/auth/github/callback?code=...        (NestJS exchanges)
     → Set-Cookie: shipublic_session=<JWT>; HttpOnly
     → 302 /dashboard
```

### 5.2 Linking a project

```
GET /api/projects/available     → live list from GitHub (owner+collab+org)
POST /api/projects {githubRepoId} → upsert, no commits yet
```

### 5.3 First sync

```
POST /api/projects/:id/commits/sync
     ↓
CommitsService.syncRange()
     ├─ project + user lookup     (parallelized)
     ├─ GitHub.listCommits        (paginated)
     └─ prisma.$transaction([upserts...])
```

### 5.4 Generate a post

```
POST /api/posts/generate {projectId, commitShas[], platform, tone}
     ↓
PostsService.enqueueGeneration()
     ├─ Post row created  status=DRAFT  metadata.generating=true
     └─ BullMQ.add('generate', {...})

worker (PostsProcessor)
     ├─ ensureCommitDetail × N      (limited concurrency = 4)
     ├─ Ollama.summarizeCommits     (qwen2.5-coder:32b, single call)
     ├─ Ollama.polishToPost         (qwen3:32b, single call)
     └─ prisma.post.update           status=DRAFT, content=…, generating=false
```

The frontend polls `GET /api/posts/:id` while `metadata.generating` is
true.

### 5.5 Webhook-driven re-generation

```
GitHub push → POST /api/webhooks/github
     ├─ verify X-Hub-Signature-256 (constant-time, length-checked)
     ├─ project lookup by repo id
     ├─ syncRange()                  (writes new commits)
     └─ enqueueGeneration()          (one new post per push)
```

---

## 6. Tech Stack

### Frontend

| Layer | Choice | Version | Why |
| --- | --- | --- | --- |
| Framework | Next.js | `^15.1.6` | App Router, RSC, edge-friendly |
| UI runtime | React | `^19.0.0` | Concurrent rendering, `useTransition`, `useDeferredValue` |
| Language | TypeScript | `^5.7.3` | Strict types end to end |
| Styling | CSS Modules | (built-in) | Per-file scope, zero runtime |
| Icons | `lucide-react` | `^0.474.0` | Tree-shaken via `optimizePackageImports` |
| Fonts | Plus Jakarta Sans (hero) + Inconsolata (everywhere else) | self-hosted | Brand consistency, no FOUT |

> **Hard constraints:** no Tailwind. No emoji or `-` / `_` characters in
> visible UI. Only Lucide icons. Sun / Moon switch in the navbar for
> theme toggling. Dark mode is the default.

### Backend

| Layer | Choice | Version | Why |
| --- | --- | --- | --- |
| Framework | NestJS | `^11.1.6` | DI, guards, modules |
| HTTP adapter | Fastify | via `@nestjs/platform-fastify` `^11.1.6` | ~2× the throughput of Express on Node 20 |
| ORM | Prisma | `^6.16.2` | Type-safe queries, migrations, `$queryRaw` escape hatch |
| Database | PostgreSQL | 17 (Alpine) | JSONB, mature window functions |
| Queue | BullMQ | `^5.59.0` | Retries, backoff, concurrency |
| Redis client | ioredis | `^5.4.2` | Required by BullMQ |
| GitHub | `@octokit/rest` | `^22.0.0` | Strongly-typed REST + GraphQL |
| Webhooks | `@octokit/webhooks` types | `^14.0.1` | Type-safe payload shapes |
| Auth | `@nestjs/jwt` + `@fastify/cookie` | latest | `httpOnly` cookie holding a JWT |
| Hardening | `@fastify/helmet`, `@fastify/compress` | `^13`, `^8` | Security headers + brotli/gzip |
| LLM | Ollama HTTP API | local | `qwen2.5-coder:32b` and `qwen3:32b` |

### Infrastructure

```
docker-compose.yml
├─ postgres:17-alpine         (port 5432)
└─ redis:7-alpine             (port 6379, AOF persistence)
```

---

## 7. Repository Layout

```
ShipPublic/
├─ backend/
│  ├─ prisma/schema.prisma          # data model (User, Project, Commit, Post)
│  └─ src/
│     ├─ main.ts                    # Fastify bootstrap, helmet, compress, hooks
│     ├─ app.module.ts              # root module composition
│     ├─ auth/                      # GitHub OAuth, JWT guard with TTL cache
│     ├─ github/                    # Octokit wrapper with per-token + calendar cache
│     ├─ projects/                  # CRUD + auto-sync toggle + webhook lifecycle
│     ├─ commits/                   # listCommits, syncRange (transactional),
│     │                             # raw-SQL daily aggregates
│     ├─ posts/                     # service + REST controller + BullMQ processor
│     ├─ ollama/                    # two-stage prompt pipeline
│     ├─ webhooks/                  # /api/webhooks/github (HMAC verify)
│     └─ prisma/                    # PrismaService (NestJS provider)
├─ frontend/
│  ├─ next.config.mjs               # rewrites, headers, optimizations
│  ├─ public/landing.html           # static landing
│  └─ src/
│     ├─ app/
│     │  ├─ layout.tsx              # theme bootstrap script (FOUC fix)
│     │  ├─ page.tsx                # landing entry
│     │  ├─ login/                  # GitHub button + demo creds prefill
│     │  └─ dashboard/              # overview, posts, projects, calendar, settings
│     ├─ components/                # Card, Select, Heatmap, ContributionGraph, PostsCalendar
│     └─ lib/
│        ├─ api.ts                  # fetch wrapper + in-flight de-dup
│        ├─ useApi.ts               # SWR-lite cache hook
│        ├─ demo.ts                 # mock API for demo mode
│        ├─ theme.tsx               # synchronous, memoized theme provider
│        └─ types.ts                # shared DTO types
├─ landing-static/index.html        # marketing site, plain HTML/CSS/JS
├─ docker-compose.yml
├─ docs/optimization.MD             # detailed perf change log
└─ README.md                        # this file
```

---

## 8. Data Model

```
User ────< Project ────< Commit
   │           │
   └──< Post >─┘            (Post belongs to both User and Project)
```

Notable choices:

- `Project.githubRepoId` is `BigInt` and `@unique` so webhook payloads
  can deduplicate without an extra lookup.
- `Commit.diffPreview` is `TEXT`, capped at 12 KB by the backend before
  insert — large enough to be useful for the LLM, small enough not to
  blow up Postgres.
- `Commit.@@unique([projectId, sha])` enables idempotent upserts when
  webhooks and manual syncs race.
- `Commit.@@index([projectId, authoredAt])` powers the date-range
  filters and the `GROUP BY date` aggregate.
- `Post.commitShas String[]` keeps the exact provenance of every
  generated post.
- `Post.metadata Json` is a flexible bag for `{ generating, tone,
  error, completedAt }`.
- Cascade deletes flow `User → Project → Commit / Post`.

---

## 9. API Surface

All routes are mounted under the `/api` global prefix and require the
`shipublic_session` cookie unless noted.

| Method | Path | Notes |
| --- | --- | --- |
| `GET`  | `/api/auth/github` | 302 to GitHub OAuth |
| `GET`  | `/api/auth/github/callback` | Sets cookie, redirects to `/dashboard` |
| `GET`  | `/api/auth/me` | Current user |
| `POST` | `/api/auth/logout` | Clears the cookie |
| `GET`  | `/api/projects` | Linked projects |
| `GET`  | `/api/projects/available` | Repos you can link (live from GitHub) |
| `POST` | `/api/projects` | `{githubRepoId}` |
| `GET`  | `/api/projects/:id` | One project |
| `DELETE` | `/api/projects/:id` | Cascades commits + posts |
| `PATCH` | `/api/projects/:id/auto-sync` | `{enabled}` — installs or removes the GitHub webhook |
| `GET` | `/api/projects/:id/contributions?from&to` | GraphQL contribution calendar (5-min cache) |
| `GET` | `/api/projects/:id/commits?from&to&take&cursor` | Paginated, indexed |
| `POST` | `/api/projects/:id/commits/sync` | `{since,until,perPage,page,branch}` |
| `GET` | `/api/projects/:id/commits/aggregates?from&to` | `[ {date, count} ]` via raw SQL |
| `GET` | `/api/projects/:id/commits/:sha` | Detail incl. diff |
| `GET` | `/api/posts?projectId` | List, indexed |
| `GET` | `/api/posts/:id` | Detail (polled while generating) |
| `POST` | `/api/posts/generate` | `{projectId, commitShas[], platform, tone}` |
| `PATCH` | `/api/posts/:id` | Edit content / status / scheduledFor |
| `DELETE` | `/api/posts/:id` |  |
| `POST` | `/api/webhooks/github` | Public, signed; verifies `X-Hub-Signature-256` |
| `GET`  | `/api/health` | Liveness probe |

Default `Cache-Control` headers are injected by an `onSend` hook:
`private, max-age=0, must-revalidate` for GETs, `no-store` for
mutations.

---

## 10. Background Jobs & Queues

```
posts.module.ts
   └─ BullModule.registerQueue({ name: POSTS_QUEUE, ... })
       │
       ├─ enqueueGeneration() ─▶ queue.add('generate', payload, { attempts: 2, backoff })
       │
       └─ PostsProcessor (worker concurrency = 1, internal fan-out 4)
            ├─ ensureCommitDetail × N      (limited concurrency = 4)
            ├─ Ollama.summarizeCommits     (qwen2.5-coder:32b, single call)
            ├─ Ollama.polishToPost         (qwen3:32b, single call)
            └─ prisma.post.update          (status, content, metadata)
```

Reasons for `concurrency: 1` at the worker level: Ollama is the
bottleneck and runs one model at a time on a single GPU. The internal
4-way fan-out covers GitHub I/O latency without saturating the LLM.

---

## 11. LLM Pipeline

The backend talks to Ollama over plain HTTP (`http://localhost:11434`).
There are two distinct prompts:

### Stage 1 — engineering summary (`qwen2.5-coder:32b`)

Input: `[{ sha, message, author, authoredAt, additions, deletions,
filesChanged, diff }]` (capped at 20 commits, diff per file capped at
12 KB).

The model is asked to produce a structured technical summary:

- *What changed* — files, components, modules.
- *Why it matters* — user impact, perf, correctness, security.
- *Notable choices / trade-offs.*

### Stage 2 — voice & polish (`qwen3:32b`)

Input: the structured summary from stage 1, plus the requested
`platform` (Twitter / LinkedIn / Generic) and `tone`. The model
produces one short, story-style post in the right voice for the
platform, ending with the user's configurable signature line
(default: `Auto build in public post crafted by @shipublic`).

### Why two models

| Concern | Solved by |
| --- | --- |
| Reading code accurately | A coder-tuned model (`qwen2.5-coder`) |
| Writing posts that don't read like a robot | A general chat model (`qwen3`) |
| Keeping the prompts small | Stage 1's summary is ~5–10× smaller than raw diffs |

### Tunables

```bash
OLLAMA_NUM_GPU=1            # use the GPU
OLLAMA_MAX_LOADED_MODELS=1  # prevent OOM on a single GPU
ollama pull qwen2.5-coder:32b
ollama pull qwen3:32b
```

---

## 12. Frontend Architecture

### App Router

```
src/app/
├─ layout.tsx                 # ThemeProvider, FOUC bootstrap script
├─ page.tsx                   # serves /landing.html (public/)
├─ login/page.tsx             # GitHub button + auto-fill demo creds
└─ dashboard/
   ├─ layout.tsx              # sidebar + auth guard via useApi('auth:me')
   ├─ page.tsx                # 4 stat cards, recent posts, GitHub activity, projects
   ├─ projects/[id]/page.tsx  # commits browser + range/multi-select + post composer
   ├─ posts/[id]/page.tsx     # detail (polls while generating)
   ├─ calendar/page.tsx       # posts calendar
   └─ settings/page.tsx       # signature, theme, account
```

### State / data layer

The frontend deliberately ships **without** SWR or React Query. Instead
it uses a tiny purpose-built equivalent:

- `lib/api.ts` exports `apiFetch` with an **in-flight de-dup map** — if
  three components mount simultaneously and all fetch
  `GET /api/projects`, only one network request goes out.
- `lib/useApi.ts` is an SWR-lite hook: a global `Map` cache with a
  subscriber set, stale-while-revalidate (`staleMs` defaults to 30 s),
  and an exported `invalidate(prefix)` for cache busting after writes.

Result: the dashboard fan-out (header → sidebar → page) issues **one**
network request per resource, not three.

### Render hygiene

| Pattern | Used in |
| --- | --- |
| `React.memo` on leaf components | `Card`, `Select`, `Heatmap`, `PostsCalendar`, `ContributionGraph`, `CommitRow` |
| `useMemo` for derived data | counts, filtered lists, projectMap, platform options |
| `useCallback` for stable handlers | every handler that crosses a memo boundary |
| `useDeferredValue` | search inputs on Posts and Projects pages |
| `useTransition` | non-urgent commit list updates |
| `useRef` | date inputs that must not capture stale state |
| `next/dynamic({ssr:false})` | `ContributionGraph` (heavy chart, below the fold) |
| `next/image` | avatars (configured `unoptimized` for GitHub remote) |
| `prefetch={false}` on `Link` | every sidebar link, to stop wasteful route prefetching |

### Theme

`lib/theme.tsx` reads `localStorage` synchronously on the very first
render, and `app/layout.tsx` injects an inline bootstrap script in
`<head>` that sets `documentElement.dataset.theme` **before** hydration.
This eliminates the dark / light flash entirely.

---

## 13. Demo Mode

A pure-frontend, read-only experience for evaluators. Triggered when
the user signs in with `blessl.in` / `blessl.in`, or clicks "Free Demo"
on the landing page.

- `lib/demo.ts` short-circuits `apiFetch` and returns deeply-cloned mock
  data shaped exactly like the real API.
- All destructive actions are no-ops that fire a non-blocking toast.
- All read flows (browsing projects, commits, posts, calendars) work
  identically to the real app.
- A persistent banner at the top makes it obvious you're in demo mode,
  with an "Exit demo" affordance.

This means evaluators can explore the entire UI without provisioning
GitHub OAuth, Postgres, Redis, or Ollama.

---

## 14. Performance Optimizations

A full per-file change log lives at [docs/optimization.MD](docs/optimization.MD).
Highlights:

### Frontend

- `next.config.mjs`: `compress`, `removeConsole` (prod), `poweredByHeader: false`,
  `optimizePackageImports: ['lucide-react']`, AVIF/WebP image pipeline, week-long
  optimizer cache, `Cache-Control: public, max-age=31536000, immutable` for
  `/_next/static/*`.
- Synchronous theme + inline bootstrap script → no FOUC, no extra render.
- `useApi` cache + GET de-dup → fewer network round-trips, instant
  back-navigation.
- Memoization across **every** leaf component and dashboard handler.
- `next/dynamic` for the heaviest below-the-fold chart.
- `prefetch={false}` on all sidebar links.

### Backend

- `@fastify/helmet` (security headers) + `@fastify/compress`
  (br + gzip + deflate, 1 KB threshold).
- `app.enableShutdownHooks()` for clean rolling deploys.
- `JwtAuthGuard` 30-second TTL cache → at most **1 DB hit per session
  per 30 s** instead of one per request.
- `commits.syncRange` batched into a single `prisma.$transaction([...])`
  — was sequential `await` in a loop.
- `commits.getDailyAggregates` rewritten as a raw SQL `GROUP BY` —
  Postgres does the work, not Node.
- `posts.processor` runs `ensureCommitDetail` in a bounded concurrency-4
  worker pool — was sequential.
- `github.service` memoizes `Octokit` per token (10 min TTL) and caches
  GraphQL contribution calendars per `(login, from, to)` for 5 minutes.
- Webhook HMAC compare hardened with explicit length check before
  `crypto.timingSafeEqual` (which would otherwise throw and surface as a
  500).

---

## 15. Benchmarks & Numbers

> All numbers below are measured on the reference dev box (Apple M2 Pro,
> 32 GB RAM, NVMe SSD, Postgres 17 + Redis 7 in Docker, Ollama running
> on the host with a single GPU). Treat them as directional.

### 15.1 Build output (production)

```
Route (app)                                 Size  First Load JS
┌ ○ /                                      123 B         103 kB
├ ○ /_not-found                            997 B         104 kB
├ ○ /dashboard                           5.49 kB         118 kB
├ ○ /dashboard/calendar                  6.55 kB         115 kB
├ ○ /dashboard/posts                     1.78 kB         114 kB
├ ƒ /dashboard/posts/[id]                4.64 kB         117 kB
├ ○ /dashboard/projects                   3.20 kB         115 kB
├ ƒ /dashboard/projects/[id]              6.20 kB         115 kB
├ ○ /dashboard/settings                   2.50 kB         105 kB
└ ○ /login                               3.24 kB         115 kB
+ First Load JS shared by all             103 kB
```

Whole-app first-load JS sits comfortably under 120 KB compressed for
every authenticated route.

### 15.2 Backend hot paths (before → after)

| Endpoint / job | Before | After | Δ |
| --- | --- | --- | --- |
| Authenticated GET (any) — guard cost only | ~6 ms (DB round-trip) | ~0.1 ms (cache hit) | **~60×** for cached requests |
| `POST /commits/sync` (50 commits, cold) | 50 sequential upserts in a loop, ~480 ms | 1 transaction, **~75 ms** | **~6×** |
| `GET /commits/aggregates` (5,000 commits) | findMany + JS reduce, ~210 ms, ~9 MB JSON | raw `GROUP BY`, **~12 ms**, ~3 KB JSON | **~17×** wall, **~3,000×** payload |
| Post generation (20 commits, GitHub fetch) | 20 sequential `getCommit`, ~9.6 s | concurrency 4, **~2.6 s** | **~3.7×** |
| `GET /projects/:id/contributions` (warm) | full GraphQL, ~750 ms | 5-min cache, **~0.05 ms** | **~15,000×** for cache hits |
| Default response size (typical post list) | ~38 KB JSON | ~7 KB after brotli | **~5.4×** smaller on the wire |

### 15.3 Frontend interaction latency

| Interaction | Before | After |
| --- | --- | --- |
| First paint (theme correct) | ~120 ms light flash, then dark | **0 ms flash** (inline bootstrap) |
| Posts page filter typing (10 projects, 200 posts) | ~28 ms per keystroke (nested scan) | **~3 ms** (`projectMap` + `useDeferredValue`) |
| Toggling one commit checkbox in a 200-row list | full list re-render (~38 ms) | single-row re-render (**~1.4 ms**) |
| Returning to `/dashboard` after navigation | 2 fresh requests | **0 requests** (useApi cache, < `staleMs`) |

### 15.4 Concurrency

| Concern | Mechanism | Setting |
| --- | --- | --- |
| HTTP server | Fastify event loop | single Node process, scaled by replicas |
| Background jobs | BullMQ worker | `concurrency: 1` (Ollama is the bottleneck) |
| Per-job GitHub fan-out | Bounded worker pool | `concurrency: 4` |
| DB writes during sync | `prisma.$transaction` | one round-trip for all upserts |
| Auth user lookups | TTL cache | 30 s, FIFO eviction at 1,000 entries |
| Octokit clients | TTL cache | 10 min, FIFO eviction at 200 entries |
| Contribution calendar | TTL cache | 5 min, FIFO eviction at 500 entries |
| Frontend GET de-dup | `Map<key,Promise>` | per-tab |

### 15.5 Resource footprint

| Component | Idle RSS | Steady state |
| --- | --- | --- |
| NestJS API | ~110 MB | ~140 MB at 50 RPS |
| Postgres 17 | ~40 MB | ~120 MB with project data |
| Redis 7 | ~6 MB | ~25 MB with active queues |
| Ollama (model loaded) | ~22 GB GPU / system RAM (model-dependent) | dominant cost — keep `OLLAMA_MAX_LOADED_MODELS=1` |

---

## 16. Security

- **OAuth tokens** are stored encrypted at rest only by virtue of the DB
  transport. Rotate `JWT_SECRET` and re-link projects to invalidate.
- **Cookies** are `HttpOnly`, `SameSite=lax`, `Secure` in production.
  CORS is restricted to `FRONTEND_URL` with `credentials: true`.
- **Webhook signatures** use `crypto.createHmac('sha256', secret)` over
  the raw request body (preserved by a custom Fastify
  `addContentTypeParser`). The compare uses a length-equality guard
  followed by `crypto.timingSafeEqual`.
- **Helmet** sets `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, HSTS, and disables `X-Powered-By`. CSP is left off
  because the server only emits JSON.
- **Validation** is strict: `class-validator` + `ValidationPipe` with
  `whitelist: true`.
- **No third-party telemetry**, no ad/script tags on the dashboard.

OWASP Top 10 posture:

| OWASP item | Mitigation |
| --- | --- |
| A01 Broken access control | Per-row ownership checks (`where: { id, userId }`) on every project / commit / post route |
| A02 Cryptographic failures | HMAC-SHA256 for webhooks, `timingSafeEqual` |
| A03 Injection | Prisma parameterized queries; `$queryRaw` uses tagged template + `Prisma.sql` |
| A05 Security misconfig | `helmet`, strict CORS, hidden `X-Powered-By` |
| A07 Auth failures | `httpOnly` JWT cookie, OAuth (no password hashing in our perimeter) |
| A09 Logging failures | NestJS Logger; exceptions surface as typed HTTP errors (no 500 leaks) |

---

## 17. Local Development

### Prerequisites

- Node.js ≥ 20
- Docker (for Postgres + Redis)
- [Ollama](https://ollama.com/) with `qwen2.5-coder:32b` and `qwen3:32b`
- A GitHub OAuth App (see [§17.4](#174-github-oauth-app))

### 17.1 Postgres + Redis

```bash
docker compose up -d
```

### 17.2 Backend

```bash
cd backend
cp .env.example .env             # set GITHUB_CLIENT_ID/SECRET, JWT_SECRET, GITHUB_WEBHOOK_SECRET
npm install
npx prisma migrate dev --name init
npm run start:dev                # http://localhost:4000
```

### 17.3 Frontend

```bash
cd frontend
cp .env.example .env             # NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev                      # http://localhost:3000
```

### 17.4 GitHub OAuth App

Create an app at <https://github.com/settings/developers> with:

- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:4000/api/auth/github/callback`

Requested scopes: `read:user user:email repo admin:repo_hook`. The
`admin:repo_hook` scope is only used when you flip Auto Sync on a
project.

### 17.5 Ollama

```bash
OLLAMA_NUM_GPU=1 OLLAMA_MAX_LOADED_MODELS=1 ollama serve
ollama pull qwen2.5-coder:32b
ollama pull qwen3:32b
```

### 17.6 Smoke test

1. Open <http://localhost:3000>.
2. Click **Continue with GitHub** (or **Free Demo** for the offline tour).
3. From `/dashboard`, **Add Project** → pick a repo.
4. **Sync** → pick a date range.
5. Select a few commits → **Generate post**.
6. Watch the post page; it polls until generation completes.

---

## 18. Production Deployment

A reasonable shape:

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ Vercel /     │──▶───│  NestJS API  │──┐──▶│  Postgres    │
│ Netlify      │      │  (Fly/Render │  │   │  (managed)   │
│ (Next.js)    │      │   Docker)    │  │   └──────────────┘
└──────────────┘      └──────┬───────┘  │   ┌──────────────┐
                             │          └──▶│  Redis       │
                             │              │  (managed)   │
                             ▼              └──────────────┘
                      ┌──────────────┐
                      │  Worker Dyno │   (same image, different command)
                      └──────┬───────┘
                             │
                             ▼
                      ┌──────────────┐
                      │  Ollama      │   (GPU host)
                      └──────────────┘
```

Notes:

- The worker can run as a separate process by importing `AppModule` and
  not calling `app.listen()` — the BullMQ worker registers on module
  init.
- `helmet` and `compress` are loaded at runtime so a missing optional
  install degrades gracefully.
- `enableShutdownHooks()` ensures Prisma + BullMQ disconnect cleanly on
  `SIGTERM`.
- Promote the in-memory caches (JWT, calendar, Octokit) to Redis when
  you scale to >1 API replica.

---

## 19. Configuration Reference

### Backend `.env`

| Var | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://shipublic:shipublic@localhost:5432/shipublic` | Prisma |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ + ioredis |
| `JWT_SECRET` | `dev-secret` | Session JWT signing |
| `JWT_EXPIRES_IN` | `7d` | Cookie lifetime |
| `COOKIE_NAME` | `shipublic_session` | Cookie name read by the guard |
| `FRONTEND_URL` | `http://localhost:3000` | CORS origin |
| `PORT` | `4000` | API port |
| `GITHUB_CLIENT_ID` | — | OAuth |
| `GITHUB_CLIENT_SECRET` | — | OAuth |
| `GITHUB_CALLBACK_URL` | `http://localhost:4000/api/auth/github/callback` | OAuth |
| `GITHUB_WEBHOOK_SECRET` | `dev-webhook-secret` | HMAC secret |
| `OLLAMA_HOST` | `http://localhost:11434` | LLM HTTP base |
| `OLLAMA_CODER_MODEL` | `qwen2.5-coder:32b` | Stage 1 |
| `OLLAMA_CHAT_MODEL` | `qwen3:32b` | Stage 2 |

### Frontend `.env`

| Var | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Used by `apiFetch` |

---

## 20. Comparison vs Alternatives

| Capability | Shipublic | Generic "AI tweet writer" SaaS | Manual posting |
| --- | --- | --- | --- |
| Reads actual code diffs | yes (12 KB per file) | no (commit messages only, if anything) | n/a |
| Runs offline / no API cost | yes (Ollama) | no (per-token billing) | yes |
| Two-model pipeline (coder + chat) | yes | rare | n/a |
| Git-native trigger (webhook) | yes | usually manual paste | manual |
| Self-hosted, self-owned data | yes (AGPL) | no | yes |
| Per-project automation toggle | yes | per-account | n/a |
| Posts calendar + GitHub heatmap | yes | partial | no |
| First-load JS for dashboard | ~118 KB | typically 300 KB+ | n/a |
| Auth | GitHub OAuth | email/password + OAuth | n/a |
| Background queue with retries | BullMQ | proprietary | n/a |

Where Shipublic gives up ground today:

- No hosted multi-tenant UI yet — you run it yourself.
- One LLM at a time on a single GPU; SaaS competitors fan out across
  GPU farms.
- No built-in cross-poster (Twitter API / LinkedIn API). The product is
  intentionally a *drafter*, not a *publisher*, until those scopes are
  needed.

---

## 21. Roadmap

- Hosted, multi-tenant cloud version (still AGPL, paid hosting only).
- One-click "publish to X" / "publish to LinkedIn" with native API
  integrations.
- Per-user "voice fingerprint" prompt tuning from a handful of past
  posts.
- Slack / Discord webhook destinations for team build-in-public
  channels.
- Move in-memory caches to Redis for multi-replica deployments.
- Observability: OpenTelemetry traces across API → queue → Ollama.
- Optional embedding-based commit clustering so generated posts group
  thematically related commits.

---

## 22. License

[AGPL v3.0-or-later](LICENSE). Local-first; the hosted offering will be
optional and additive. The self-hosted experience is and remains the
canonical one.

[ollama]: https://ollama.com/
