# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

FlowX is a staged, interruptible, human-confirmable AI R&D orchestration system. Users create requirements, launch workflows, and confirm/reject AI output at each stage: Task Split → Technical Plan → Execution → AI Review → Human Review.

## Common commands

```bash
# Development
pnpm dev                    # Start both API (port 3000) and Web (port 5173)
pnpm dev:api                # Start API only
pnpm dev:web                # Start Web only (Vite dev server)

# Build
pnpm build                  # Build both apps
pnpm check                  # Build + test all (run before handoff)

# Testing
pnpm test                   # Run all tests
pnpm --filter flowx-api test    # API tests only
pnpm --filter flowx-web test    # Web tests only
npx vitest run path/to/test.ts  # Run a single test file

# Database
pnpm prisma:generate        # Generate Prisma client from schema
pnpm --filter flowx-api exec prisma db push --schema ../../prisma/schema.prisma  # Sync schema to DB
```

## Architecture

Monorepo with pnpm workspaces (`apps/*`).

### Backend (`apps/api`) — NestJS + Prisma + SQLite

Module-based NestJS structure under `src/`:
- **`workflow/`** — Core orchestration: `workflow.service.ts` drives stage transitions, `workflow.controller.ts` exposes REST endpoints
- **`common/`** — Shared types (`types.ts`), enums, and the workflow state machine (`workflow-state-machine.ts`) that validates all status transitions
- **`ai/`** — Pluggable AI executor pattern: `AIExecutor` interface with `codex`, `cursor`, and `mock` implementations
- **`prompts/`** — Prompt templates for each workflow stage (task-split, technical-plan, execution, review)
- **`deploy/`** — Repository-level CI/CD provider abstraction (default: `noop`, extensible via `DEPLOY_PROVIDER`)
- **`auth/`** — Session-based auth with password + DingTalk OAuth providers; `SessionAuthGuard` on all routes
- **`prisma/`** — Prisma service wrapper

Key files:
- `workflow-state-machine.ts` — Defines all valid WorkflowRun and StageExecution status transitions; edit with care
- `workflow.service.ts` — Main business logic; orchestrates AI calls, stage progression, and human confirmations
- `ai-executor.ts` — Interface: `splitTasks`, `generatePlan`, `executeTask`, `reviewCode`

### Frontend (`apps/web`) — React 19 + Vite + Tailwind + shadcn/ui

- `src/api.ts` — Fetch-based API client with Bearer token auth
- `src/types.ts` — TypeScript interfaces mirroring backend models
- `src/pages/` — Page components (Workspaces, Projects, Requirements, WorkflowRuns, etc.)
- `src/components/ui/` — shadcn/ui primitives
- Vite dev server proxies `/api` → `http://127.0.0.1:3000`

### Database (`prisma/`)

SQLite via Prisma ORM. Schema at `prisma/schema.prisma`. Core models: Workspace, Project, Repository, Requirement, WorkflowRun, StageExecution, Task, Plan, CodeExecution, ReviewReport, ReviewFinding, Issue, Bug, plus auth and deploy models.

### Workflow state machine

WorkflowRun progresses through: `CREATED → REPOSITORY_GROUNDING_PENDING → TASK_SPLIT_PENDING → TASK_SPLIT_WAITING_CONFIRMATION → TASK_SPLIT_CONFIRMED → PLAN_PENDING → PLAN_WAITING_CONFIRMATION → PLAN_CONFIRMED → EXECUTION_PENDING → EXECUTION_RUNNING → REVIEW_PENDING → HUMAN_REVIEW_PENDING → DONE/FAILED`

StageExecution: `PENDING → RUNNING → WAITING_CONFIRMATION / COMPLETED / FAILED`

## High-risk zones

These files require narrow diffs and test-first changes:
- `apps/api/src/workflow/` and `apps/api/src/common/workflow-state-machine.ts`
- `apps/web/src/api.ts`
- `prisma/schema.prisma`

## Change protocol

1. Clarify which subsystem is changing before editing.
2. Add/update tests first when touching high-risk logic.
3. Make the smallest change that satisfies the requirement.
4. Run the narrow validation command for the touched subsystem.
5. Run `pnpm check` before handoff or merge.

## Environment setup

Create `.env` in repo root with: `DATABASE_URL="file:./dev.db"`, `PORT=3000`, `VITE_API_BASE_URL="http://localhost:3000"`, plus DingTalk vars if needed. AI executor defaults to `mock`; set `AI_EXECUTOR_PROVIDER=codex` with `OPENAI_API_KEY` for real AI execution.
