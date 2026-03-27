# AI R&D Orchestration MVP

This repository contains a staged, interruptible, human-confirmable AI研发调度系统 MVP.

## Stack

- Backend: NestJS + TypeScript + Prisma + SQLite
- Frontend: React + Ant Design + Vite
- AI integration: provider abstraction with a mock executor

## Structure

- `docs/system-design.md`: MVP system design
- `apps/api`: backend service
- `apps/web`: basic management UI
- `prisma`: Prisma schema

## Quick start

1. Create `.env` in the repository root:

```env
DATABASE_URL="file:./dev.db"
PORT=3000
VITE_API_BASE_URL="http://localhost:3000"
DINGTALK_APP_ID=""
DINGTALK_APP_SECRET=""
```

2. Install dependencies:

```bash
npm install
```

3. Generate Prisma client and sync schema:

```bash
pnpm prisma:generate
pnpm --filter flowx-api exec prisma db push --schema ../../prisma/schema.prisma
```

4. Start both apps:

```bash
pnpm dev
```

## Docker deployment

This repo includes a multi-stage `Dockerfile` that builds both the API and the web app.

Build the image:

```bash
docker build \
  --build-arg VITE_API_BASE_URL="http://YOUR_SERVER_IP:3000" \
  -t flowx:latest .
```

Run the container:

```bash
docker run -d \
  --name flowx \
  -p 3000:3000 \
  -p 4173:4173 \
  -e PORT=3000 \
  -e WEB_PORT=4173 \
  -e DATABASE_URL="file:/data/dev.db" \
  -e AI_EXECUTOR_PROVIDER="codex" \
  -e DINGTALK_APP_ID="your_app_id" \
  -e DINGTALK_APP_SECRET="your_app_secret" \
  -v flowx-data:/data \
  flowx:latest
```

Notes:

- API runs on `3000`
- Web runs on `4173`
- SQLite data is stored in `/data/dev.db`, so mounting `/data` is recommended
- If your server environment does not provide Codex CLI, set `AI_EXECUTOR_PROVIDER="mock"` temporarily

## Auth

- Built-in user system with extensible third-party provider abstraction.
- Supports account/password login and registration.
- DingTalk login is available at `/auth/dingtalk/*`.
- For real DingTalk OAuth, set `DINGTALK_APP_ID`, `DINGTALK_APP_SECRET`, and optionally override endpoints via:
  - `DINGTALK_AUTHORIZE_URL`
  - `DINGTALK_TOKEN_URL`
  - `DINGTALK_PROFILE_URL`
  - `DINGTALK_ORGS_URL`

## MVP flow

1. Create requirement
2. Start workflow
3. Run task split
4. Human confirm or reject task split
5. Run technical plan
6. Human confirm or reject plan
7. Run execution
8. Run AI review
9. Inspect full stage history
