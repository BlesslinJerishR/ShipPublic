# Shipublic Backend

NestJS 11 with Fastify, Prisma 6, BullMQ, GitHub OAuth, Ollama integration.

## Requirements
- Node 20 or newer
- PostgreSQL 15+
- Redis 7+
- Ollama running locally with models `qwen2.5-coder:32b` and a chat model (default `qwen3:32b`)
- A GitHub OAuth App

## Setup
```
cp .env.example .env
# fill in GITHUB_CLIENT_ID / SECRET and DB / Redis URLs
npm install
npx prisma migrate dev --name init
npm run start:dev
```

API listens on `http://localhost:4000`.

## Routes
- `GET  /api/auth/github` — start OAuth
- `GET  /api/auth/github/callback`
- `GET  /api/auth/me`
- `GET  /api/auth/logout`
- `GET  /api/projects`
- `GET  /api/projects/available`
- `POST /api/projects` `{ githubRepoId }`
- `PATCH /api/projects/:id/auto-sync` `{ enabled }`
- `GET  /api/projects/:id/contributions?from&to`
- `GET  /api/projects/:projectId/commits?from&to`
- `POST /api/projects/:projectId/commits/sync` `{ since, until, branch }`
- `GET  /api/projects/:projectId/commits/aggregates?from&to`
- `GET  /api/projects/:projectId/commits/:sha`
- `POST /api/posts/generate` `{ projectId, commitShas?, rangeFrom?, rangeTo?, platform?, tone? }`
- `GET  /api/posts?projectId=`
- `GET  /api/posts/:id`
- `PATCH /api/posts/:id`
- `DELETE /api/posts/:id`
- `POST /api/webhooks/github` (configured automatically when auto sync is enabled)

License: AGPL-3.0-or-later
