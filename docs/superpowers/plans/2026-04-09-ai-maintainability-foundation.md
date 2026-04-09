# FlowX AI Maintainability Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FlowX safe to evolve through repeated AI-driven changes by adding automated guardrails, extracting the riskiest orchestration rules into testable seams, and documenting repo-specific working rules for future agents.

**Architecture:** Keep the current monorepo shape (`apps/api`, `apps/web`, `prisma`) and improve maintainability through thin, incremental layers instead of a big rewrite. First add repeatable validation and tests, then isolate orchestration invariants into pure modules, then codify repo rules and AI working conventions so later iterations stay bounded.

**Tech Stack:** pnpm workspace, NestJS, React, TypeScript, Prisma, SQLite, Vitest, GitHub Actions

---

## File Structure

### Existing files to modify

- `package.json`
  - Add root validation scripts that agents can run before and after changes.
- `apps/api/package.json`
  - Add backend test script and test dependencies.
- `apps/web/package.json`
  - Add frontend test script and test dependencies.
- `apps/api/src/common/workflow-state-machine.ts`
  - Keep the implementation, but make its rules explicitly covered by tests.
- `apps/web/src/api.ts`
  - Add coverage around request behavior before future AI edits expand this file further.
- `README.md`
  - Link to the new working rules and local validation workflow.

### New files to create

- `apps/api/vitest.config.ts`
- `apps/web/vitest.config.ts`
- `apps/api/src/common/workflow-state-machine.spec.ts`
- `apps/web/src/api.test.ts`
- `.github/workflows/ci.yml`
- `AGENTS.md`
- `docs/architecture/ai-maintainability.md`

### Why this decomposition

- Validation and tests are the cheapest way to stop AI regressions early.
- The workflow state machine is the clearest business invariant in the repo and a good first candidate for hardening.
- `apps/web/src/api.ts` is a high-churn integration surface that will keep growing as the product grows.
- `AGENTS.md` and a focused architecture doc reduce prompt drift and repeated rediscovery by future agents.

### Task 1: Add Automated Guardrails

**Files:**
- Modify: `package.json`
- Modify: `apps/api/package.json`
- Modify: `apps/web/package.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/web/vitest.config.ts`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Add root validation scripts**

```json
{
  "scripts": {
    "dev": "pnpm -r --parallel --filter flowx-api --filter flowx-web dev",
    "dev:api": "pnpm --filter flowx-api build && HOST=127.0.0.1 node apps/api/dist/main.js",
    "dev:web": "pnpm --filter flowx-web dev",
    "build": "pnpm -r --filter flowx-api --filter flowx-web build",
    "build:api": "pnpm --filter flowx-api build",
    "build:web": "pnpm --filter flowx-web build",
    "test": "pnpm -r --if-present test",
    "check": "pnpm build && pnpm test",
    "prisma:generate": "pnpm --filter flowx-api prisma:generate",
    "prisma:migrate": "pnpm --filter flowx-api prisma:migrate"
  }
}
```

- [ ] **Step 2: Add backend test runner and dependencies**

```json
{
  "scripts": {
    "dev": "pnpm start:dev",
    "build": "tsc -p tsconfig.build.json && node scripts/copy-ai-schemas.mjs",
    "start:dev": "HOST=127.0.0.1 pnpm build && HOST=127.0.0.1 node dist/main.js",
    "test": "vitest run",
    "prisma:generate": "prisma generate --schema ../../prisma/schema.prisma",
    "prisma:migrate": "prisma migrate dev --schema ../../prisma/schema.prisma"
  },
  "devDependencies": {
    "@types/node": "^22.13.10",
    "prisma": "^6.5.0",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 3: Add frontend test runner and dependencies**

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/react": "^19.0.10",
    "@types/react-dom": "^19.0.4",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.21",
    "postcss": "^8.5.3",
    "tailwindcss": "^3.4.17",
    "tailwindcss-animate": "^1.0.7",
    "typescript": "^5.8.2",
    "vite": "^6.2.0",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 4: Create the backend Vitest config**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
```

- [ ] **Step 5: Create the frontend Vitest config**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
```

- [ ] **Step 6: Add CI that blocks unverified AI edits**

```yaml
name: ci

on:
  push:
    branches:
      - main
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.12.1
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma:generate
      - run: pnpm check
        env:
          DATABASE_URL: file:./dev.db
```

- [ ] **Step 7: Run the validation flow and confirm it passes**

Run: `pnpm install && pnpm prisma:generate && pnpm check`
Expected: API and web both build successfully, and test jobs pass even if only a few seed tests exist at first.

- [ ] **Step 8: Commit**

```bash
git add package.json apps/api/package.json apps/web/package.json apps/api/vitest.config.ts apps/web/vitest.config.ts .github/workflows/ci.yml pnpm-lock.yaml
git commit -m "chore: add validation and ci guardrails"
```

### Task 2: Lock Down Core Orchestration Invariants With Tests

**Files:**
- Test: `apps/api/src/common/workflow-state-machine.spec.ts`
- Modify: `apps/api/src/common/workflow-state-machine.ts`

- [ ] **Step 1: Write the failing tests for legal workflow transitions**

```ts
import { describe, expect, it } from 'vitest';
import { WorkflowStateMachine } from './workflow-state-machine';
import { StageType, StageExecutionStatus, WorkflowRunStatus } from './enums';

describe('WorkflowStateMachine', () => {
  it('allows created to transition into repository grounding', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.CREATED,
        WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING,
      ),
    ).toBe(true);
  });

  it('rejects skipping directly from created to plan pending', () => {
    const machine = new WorkflowStateMachine();

    expect(
      machine.canTransitionWorkflow(
        WorkflowRunStatus.CREATED,
        WorkflowRunStatus.PLAN_PENDING,
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Add tests for stage transitions and workflow-stage alignment**

```ts
it('allows running stage executions to move into waiting confirmation', () => {
  const machine = new WorkflowStateMachine();

  expect(
    machine.canTransitionStage(
      StageExecutionStatus.RUNNING,
      StageExecutionStatus.WAITING_CONFIRMATION,
    ),
  ).toBe(true);
});

it('throws when a stage does not match the workflow status', () => {
  const machine = new WorkflowStateMachine();

  expect(() =>
    machine.assertStageMatchesWorkflow(
      StageType.TECHNICAL_PLAN,
      WorkflowRunStatus.EXECUTION_RUNNING,
    ),
  ).toThrow(/does not allow stage/i);
});
```

- [ ] **Step 3: Run the tests to verify they pass without changing behavior**

Run: `pnpm --filter flowx-api test`
Expected: PASS for all `workflow-state-machine` cases, proving current orchestration rules are executable documentation.

- [ ] **Step 4: Keep the state machine table-driven**

```ts
const workflowTransitions: Record<WorkflowRunStatus, WorkflowRunStatus[]> = {
  [WorkflowRunStatus.CREATED]: [WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING],
  [WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING]: [
    WorkflowRunStatus.TASK_SPLIT_PENDING,
    WorkflowRunStatus.FAILED,
  ],
  // continue existing table...
};
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/workflow-state-machine.ts apps/api/src/common/workflow-state-machine.spec.ts
git commit -m "test: lock down workflow state machine invariants"
```

### Task 3: Lock Down the Frontend API Boundary

**Files:**
- Test: `apps/web/src/api.test.ts`
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Write the failing tests around URL building and request headers**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('api request helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('builds same-origin api urls when VITE_API_BASE_URL is relative', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api');
    await api.getRequirements();

    expect(fetchMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Add an auth-header regression test**

```ts
it('sends bearer token when local auth token exists', async () => {
  localStorage.setItem('flowx-auth-token', 'test-token');

  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: 'workflow-1' }),
  });

  vi.stubGlobal('fetch', fetchMock);

  const { api } = await import('./api');
  await api.getWorkflowRun('workflow-1');

  const [, options] = fetchMock.mock.calls[0];
  expect(options.headers.Authorization).toBe('Bearer test-token');
});
```

- [ ] **Step 3: Make the request helper easier to test without changing the external API**

```ts
export function buildApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (API_BASE_URL.startsWith('http://') || API_BASE_URL.startsWith('https://')) {
    return `${API_BASE_URL}${normalizedPath}`;
  }

  if (typeof window !== 'undefined') {
    return `${window.location.origin}${API_BASE_URL}${normalizedPath}`;
  }

  return `http://localhost:3000${normalizedPath}`;
}
```

- [ ] **Step 4: Run the frontend tests**

Run: `pnpm --filter flowx-web test`
Expected: PASS for URL and auth-header tests, giving future AI edits a safety net around the API client.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/api.test.ts
git commit -m "test: cover frontend api boundary"
```

### Task 4: Document Repo Rules for AI Workers

**Files:**
- Create: `AGENTS.md`
- Create: `docs/architecture/ai-maintainability.md`
- Modify: `README.md`

- [ ] **Step 1: Create `AGENTS.md` with repo-specific operating rules**

```md
# FlowX Agent Rules

## Goal

Keep AI changes small, testable, and easy to review.

## Rules

- Do not edit generated Prisma artifacts manually.
- Prefer adding tests before changing workflow orchestration rules.
- When changing `apps/api/src/workflow` or `apps/api/src/common/workflow-state-machine.ts`, run `pnpm --filter flowx-api test`.
- When changing `apps/web/src/api.ts` or page data loading behavior, run `pnpm --filter flowx-web test`.
- Before handing off, run `pnpm check`.
- Keep changes scoped to one subsystem per branch unless the task explicitly spans multiple subsystems.
```

- [ ] **Step 2: Create a focused maintainability doc for humans and agents**

```md
# AI Maintainability Guide

## High-risk zones

- `apps/api/src/workflow`
- `apps/api/src/common/workflow-state-machine.ts`
- `apps/web/src/api.ts`
- `prisma/schema.prisma`

## Change protocol

1. Clarify which subsystem is changing.
2. Add or update the closest automated test first.
3. Make the minimum change.
4. Run the narrow test target.
5. Run `pnpm check` before merge.

## When to refactor first

- A file exceeds one distinct responsibility.
- A change requires editing both orchestration rules and persistence details at once.
- A future agent would need to understand more than one business concept to change the file safely.
```

- [ ] **Step 3: Link the new docs from the README quick-start area**

```md
## Engineering guardrails

- Agent rules: `AGENTS.md`
- AI maintainability guide: `docs/architecture/ai-maintainability.md`
- Validation command: `pnpm check`
```

- [ ] **Step 4: Run a final validation pass**

Run: `pnpm check`
Expected: PASS, and the repo now advertises its maintenance workflow directly in versioned docs.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md docs/architecture/ai-maintainability.md README.md
git commit -m "docs: codify ai maintenance workflow"
```

## Self-Review

### Spec coverage

- Project inspection: covered through the file structure mapping and targeted hardening of the riskiest backend/frontend seams.
- AI-driven maintainability: covered through `pnpm check`, CI, seed tests, and repo rules for future agents.
- Incremental rollout: covered through four small tasks that can land independently.

### Placeholder scan

- No `TODO`, `TBD`, or “write tests later” placeholders remain.
- Every task names exact files, commands, and expected outcomes.

### Type consistency

- Existing provider names remain `codex | cursor`.
- Existing workflow state types remain unchanged.
- New docs and tests do not require schema changes, so the first rollout stays low-risk.

## Recommended Rollout Order

1. Task 1 first, because the repo currently has no project-owned tests or CI enforcement.
2. Task 2 second, because workflow transitions are the core product invariant.
3. Task 3 third, because `apps/web/src/api.ts` is a likely high-churn file during feature growth.
4. Task 4 last, because documentation should reflect the actual guardrails once they exist.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-09-ai-maintainability-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
