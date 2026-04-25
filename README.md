# Shipublic
.git commits, diffs, commit messages automatically turned into build in public posts.

A fully local automation tool that converts your Git commits and code changes into clean, engaging "build in public" updates.

It analyzes diffs, understands what changed and why, and generates ready-to-post content for platforms like LinkedIn or Twitter. No cloud. No API costs. Just your machine doing the thinking.

## Quick start

Prereqs: Node 20+, Docker, Ollama (with `qwen2.5-coder:32b` and a chat model such as `qwen3:32b`), and a GitHub OAuth App.

```
# 1. Postgres + Redis
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env  # set GITHUB_CLIENT_ID / SECRET, JWT_SECRET, GITHUB_WEBHOOK_SECRET
npm install
npx prisma migrate dev --name init
npm run start:dev   # http://localhost:4000

# 3. Frontend (new terminal)
cd ../frontend
cp .env.example .env
npm install
npm run dev         # http://localhost:3000

# 4. Ollama (in another terminal)
OLLAMA_NUM_GPU=1 OLLAMA_MAX_LOADED_MODELS=1 ollama serve
ollama pull qwen2.5-coder:32b
ollama pull qwen3:32b
```

Open http://localhost:3000, click "Continue with GitHub", and you land on `/dashboard`.

## GitHub OAuth App

Create an OAuth App at https://github.com/settings/developers with:
- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:4000/api/auth/github/callback`

The app requests scopes `read:user user:email repo admin:repo_hook` (the last is needed only when you flip Auto sync on a project, which installs a webhook).

## Architecture

- Frontend: Next.js 15 + TypeScript + CSS Modules + Lucide icons. Dark mode default. Strict color palette: `#1D1E21`, `#FFFFFF`, `#FF004F` (light mode swaps bg/text to white/black).
- Backend: NestJS 11 + Fastify + Prisma 6 (PostgreSQL) + BullMQ (Redis).
- Pipeline: commits and diffs are pulled from GitHub, fed to `qwen2.5-coder:32b` for a structured technical summary, then passed to a chat model (`qwen3:32b` by default) to write the final post. Auto sync installs a GitHub webhook that re-triggers the pipeline on every push.

## Features

- GitHub OAuth login
- Pick any repo you can access and link it as a project
- Browse commits, filter by date range, multi select, or pick the whole range
- Sync from GitHub on demand or automatically via webhook
- Generate posts (Twitter, LinkedIn, Generic) using the local Ollama pipeline
- Edit, schedule, mark published, copy to clipboard
- GitHub contributions heatmap and a separate posts calendar

## License
AGPL v3.0. Local first, monetization later.

