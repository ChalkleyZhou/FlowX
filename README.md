# AI R&D Orchestration MVP

This repository contains a staged, interruptible, human-confirmable AI研发调度系统 MVP.

## Stack

- Backend: NestJS + TypeScript + Prisma + PostgreSQL
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
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/flowx?schema=public"
PORT=3000
VITE_API_BASE_URL="http://localhost:3000"
```

2. Install dependencies:

```bash
npm install
```

3. Generate Prisma client and run migrations:

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
```

4. Start both apps:

```bash
npm run dev
```

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

