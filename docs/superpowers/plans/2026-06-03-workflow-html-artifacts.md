# Workflow HTML Artifacts (Plan Stage First) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Human gate:** Do not start implementation until the product owner approves this document.

**Goal:** Store each workflow stage deliverable as a versioned HTML file under `.flowx-data`, keep SQLite as pointers/metadata only, and ship the first vertical slice on **TECHNICAL_PLAN** (`plan/v{n}/plan.html`) with Web preview and execution reading `plan.meta.json`.

**Architecture:** Introduce `WorkflowArtifactService` for filesystem layout, HTML rendering (from validated `GeneratePlanOutput`), and `manifest.json` pointers. `WorkflowService.runPlan` writes artifacts when AI completes; `confirmPlan` marks confirmed in manifest; `runExecution` loads plan from meta file with DB fallback. Web shows sandboxed iframe via authenticated artifact endpoint. AI still validates JSON at the boundary; HTML is the human-canonical view.

**Tech Stack:** NestJS, Prisma (no schema change in slice 1), Vitest, React/Vite, existing `GeneratePlanOutput` / plan JSON schemas.

**Out of scope (later plans):** MCP package, VS Code extension, local-agent `claim-local` execution, TOML manifest (slice 1 uses JSON sidecars), migrating all ideation stages to HTML, removing `Plan` table.

---

## Background (decisions already agreed)

| Decision | Choice |
|----------|--------|
| Storage shape | One HTML file per stage, versioned directories `v1`, `v2`, … |
| DB role | Pointers + small summary; not large `StageExecution.output` blobs long-term |
| Plan machine-readable sidecar | `plan.meta.json` (JSON in v1; TOML optional later) |
| Manifest | `artifacts/manifest.json` maps stage → current version/path |
| Code truth | Git in `workflows/{runId}/repositories/*` only |
| HTML generation | Server template from validated JSON (not raw model HTML) |

---

## Target directory layout

```text
.flowx-data/workflows/{workflowRunId}/
├── repositories/              # existing clones
└── artifacts/
    ├── manifest.json
    ├── shared/
    │   └── flowx-artifact.css # optional shared styles
    └── plan/
        └── v{n}/
            ├── plan.html
            └── plan.meta.json
```

### `manifest.json` shape (slice 1)

```json
{
  "plan": {
    "version": 1,
    "path": "plan/v1/plan.html",
    "metaPath": "plan/v1/plan.meta.json",
    "sha256": "<hex>",
    "confirmedAt": null
  }
}
```

### `plan.meta.json` shape

```json
{
  "summary": "string",
  "implementationPlan": ["string"],
  "filesToModify": ["string"],
  "newFiles": ["string"],
  "riskPoints": ["string"],
  "status": "WAITING_HUMAN_CONFIRMATION",
  "confirmedAt": null
}
```

### `StageExecution.output` pointer (slice 1, backward compatible)

After artifact write, set output to:

```json
{
  "summary": "...",
  "implementationPlan": [],
  "filesToModify": [],
  "newFiles": [],
  "riskPoints": [],
  "_artifact": {
    "kind": "plan",
    "version": 1,
    "htmlPath": "plan/v1/plan.html",
    "metaPath": "plan/v1/plan.meta.json",
    "sha256": "..."
  }
}
```

Keep existing top-level plan fields so `StageCard` JSON view still works during migration.

---

## File map (slice 1)

| File | Responsibility |
|------|----------------|
| `apps/api/src/workflow/workflow-artifact.paths.ts` | Resolve `artifacts` root under `.flowx-data/workflows/{id}/` |
| `apps/api/src/workflow/workflow-artifact.render.ts` | `renderPlanHtml(output, meta)` with HTML escape |
| `apps/api/src/workflow/workflow-artifact.service.ts` | Read/write manifest, meta, html; `loadPlanMeta`, `getPlanHtml` |
| `apps/api/src/workflow/workflow-artifact.service.spec.ts` | Unit tests (render + IO with temp dir) |
| `apps/api/src/workflow/workflow.module.ts` | Register `WorkflowArtifactService` |
| `apps/api/src/workflow/workflow.service.ts` | Hook `runPlan` / `confirmPlan` / `runExecution` |
| `apps/api/src/workflow/workflow.controller.ts` | `GET :id/artifacts/plan` |
| `apps/web/src/api.ts` | `getWorkflowPlanArtifactUrl`, optional `fetchPlanArtifact` |
| `apps/web/src/pages/WorkflowRunDetailPage.tsx` | iframe preview when plan artifact exists |
| `apps/web/src/pages/WorkflowRunDetailPage.test.tsx` | Assert preview link/iframe when `_artifact` present |

---

## API contract

### `GET /workflow-runs/:id/artifacts/plan`

- Auth: same `SessionAuthGuard` as other workflow routes.
- Reads `manifest.json` → loads `plan.html` from disk.
- Response: `200`, `Content-Type: text/html; charset=utf-8`.
- Errors: `404` if no plan artifact; `404` if file missing on disk.

### `GET /workflow-runs/:id` (optional enrichment)

Add non-breaking field on workflow payload (computed, not Prisma):

```json
{
  "artifacts": {
    "plan": { "available": true, "version": 1, "confirmed": false }
  }
}
```

If omitted in slice 1, Web can infer from `stageExecutions[].output._artifact`.

---

## Security

- HTML from **server templates** only; escape all dynamic text (`summary`, list items).
- No `<script>` in template.
- Web iframe: `sandbox="allow-same-origin"` without `allow-scripts` (stricter than Demo preview).
- Artifact endpoint requires Bearer token (no public static mount of `.flowx-data`).

---

### Task 1: Artifact paths + HTML render

**Files:**
- Create: `apps/api/src/workflow/workflow-artifact.paths.ts`
- Create: `apps/api/src/workflow/workflow-artifact.render.ts`
- Create: `apps/api/src/workflow/workflow-artifact.render.spec.ts`

- [ ] **Step 1: Write failing render tests**

```ts
import { describe, expect, it } from 'vitest';
import { escapeHtml, renderPlanHtml } from './workflow-artifact.render';

describe('renderPlanHtml', () => {
  it('escapes HTML in summary', () => {
    const html = renderPlanHtml({
      summary: '<script>alert(1)</script>',
      implementationPlan: ['step & go'],
      filesToModify: [],
      newFiles: [],
      riskPoints: [],
    }, { workflowRunId: 'run_1', version: 1, status: 'WAITING_HUMAN_CONFIRMATION' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('step &amp; go');
  });

  it('includes stage title and file lists', () => {
    const html = renderPlanHtml({
      summary: 'Login welcome modal',
      implementationPlan: ['Mount modal in App'],
      filesToModify: ['src/App.tsx'],
      newFiles: ['src/WelcomeModal.tsx'],
      riskPoints: ['Rate limit TBD'],
    }, { workflowRunId: 'run_1', version: 1, status: 'WAITING_HUMAN_CONFIRMATION' });
    expect(html).toContain('技术方案');
    expect(html).toContain('src/App.tsx');
    expect(html).toContain('src/WelcomeModal.tsx');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter flowx-api test -- src/workflow/workflow-artifact.render.spec.ts`

- [ ] **Step 3: Implement `escapeHtml` + `renderPlanHtml`**

Minimal self-contained HTML document with inline CSS (no external deps). Sections: 摘要, 实施步骤, 涉及文件, 新增文件, 风险点, footer with run id + version + status.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-artifact.paths.ts \
  apps/api/src/workflow/workflow-artifact.render.ts \
  apps/api/src/workflow/workflow-artifact.render.spec.ts
git commit -m "feat(api): add plan workflow artifact HTML renderer"
```

---

### Task 2: WorkflowArtifactService (filesystem + manifest)

**Files:**
- Create: `apps/api/src/workflow/workflow-artifact.service.ts`
- Create: `apps/api/src/workflow/workflow-artifact.service.spec.ts`
- Modify: `apps/api/src/workflow/workflow.module.ts`

- [ ] **Step 1: Write failing service tests (temp directory)**

Test cases:

1. `writePlanArtifact(runId, version, output, status)` creates `plan/v{n}/plan.html`, `plan.meta.json`, updates `manifest.json`.
2. `confirmPlanArtifact(runId)` sets `meta.status = CONFIRMED`, `manifest.plan.confirmedAt` ISO string.
3. `loadPlanMeta(runId)` returns parsed meta or `null`.
4. `readPlanHtml(runId)` returns html string.

Use `mkdtemp` under OS tmp for isolated tests; mock `getWorkflowArtifactsRoot` via env `FLOWX_ARTIFACTS_ROOT` override in tests.

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter flowx-api test -- src/workflow/workflow-artifact.service.spec.ts`

- [ ] **Step 3: Implement service**

Key methods:

```ts
@Injectable()
export class WorkflowArtifactService {
  getArtifactsRoot(workflowRunId: string): string;
  async writePlanArtifact(params: {
    workflowRunId: string;
    version: number;
    output: GeneratePlanOutput;
    status: 'WAITING_HUMAN_CONFIRMATION' | 'CONFIRMED' | 'REJECTED';
  }): Promise<{ htmlPath: string; metaPath: string; sha256: string }>;
  async confirmPlanArtifact(workflowRunId: string): Promise<void>;
  async loadPlanMeta(workflowRunId: string): Promise<PlanArtifactMeta | null>;
  async readPlanHtml(workflowRunId: string): Promise<string | null>;
}
```

`sha256`: hash of `plan.html` bytes for manifest.

Register provider in `WorkflowModule`.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

---

### Task 3: Wire `runPlan` + `confirmPlan`

**Files:**
- Modify: `apps/api/src/workflow/workflow.service.ts`
- Modify: `apps/api/src/workflow/workflow.service.spec.ts` (if constructor mock needs artifact service)

- [ ] **Step 1: Inject `WorkflowArtifactService` in `WorkflowService` constructor**

Update test helper `createService()` to pass `{} as WorkflowArtifactService` or vi.fn() mock.

- [ ] **Step 2: After successful `runPlan` background transaction**

Inside the block after `updateStageExecution(..., { output })`:

1. Read `planStage.attempt` as `version`.
2. `await workflowArtifactService.writePlanArtifact({ workflowRunId: id, version, output, status: 'WAITING_HUMAN_CONFIRMATION' })`.
3. Merge `_artifact` into `output` before `updateStageExecution` OR second update with pointer fields only (prefer merge before single update).

On artifact write failure: log error, **do not fail the stage** (artifact is enhancement); optional `statusMessage` hint.

- [ ] **Step 3: In `confirmPlan`**

After plan DB status `CONFIRMED`:

`await workflowArtifactService.confirmPlanArtifact(id)`.

- [ ] **Step 4: Add integration-style unit test (mocked fs service)**

Verify `runPlan` completion path calls `writePlanArtifact` with normalized output (mock artifact service with `vi.fn()`).

- [ ] **Step 5: Run API tests**

Run: `pnpm --filter flowx-api test -- src/workflow/`

- [ ] **Step 6: Commit**

---

### Task 4: `runExecution` reads meta first

**Files:**
- Modify: `apps/api/src/workflow/workflow.service.ts`
- Test: `apps/api/src/workflow/workflow-artifact.service.spec.ts` or `workflow.service.spec.ts`

- [ ] **Step 1: Add private `resolveConfirmedPlan(workflow)`**

```ts
private async resolveConfirmedPlan(workflow: WorkflowPayload): Promise<GeneratePlanOutput> {
  const meta = await this.workflowArtifactService.loadPlanMeta(workflow.id);
  if (meta?.status === 'CONFIRMED') {
    return {
      summary: meta.summary,
      implementationPlan: meta.implementationPlan,
      filesToModify: meta.filesToModify,
      newFiles: meta.newFiles,
      riskPoints: meta.riskPoints,
    };
  }
  if (!workflow.plan) throw new NotFoundException('Confirmed plan not found.');
  return { ...workflow.plan fields };
}
```

- [ ] **Step 2: Replace `confirmedPlan = workflow.plan` in `runExecution`**

Use `await this.resolveConfirmedPlan(workflow)`.

- [ ] **Step 3: Test fallback**

When `loadPlanMeta` returns null, uses `workflow.plan` from include.

- [ ] **Step 4: Run `pnpm --filter flowx-api test`**

- [ ] **Step 5: Commit**

---

### Task 5: Artifact HTTP endpoint

**Files:**
- Modify: `apps/api/src/workflow/workflow.controller.ts`

- [ ] **Step 1: Add handler**

```ts
@Get(':id/artifacts/plan')
async getPlanArtifact(@Param('id') id: string, @Res() res: Response) {
  const html = await this.workflowService.readPlanArtifactHtml(id);
  res.type('text/html; charset=utf-8').send(html);
}
```

Delegate to service method that throws `NotFoundException` when missing.

- [ ] **Step 2: Manual smoke**

With dev API running and a workflow that completed plan generation, curl with Bearer token:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/workflow-runs/{id}/artifacts/plan | head
```

Expected: `<!DOCTYPE html>` ...

- [ ] **Step 3: Commit**

---

### Task 6: Web plan HTML preview

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`

- [ ] **Step 1: Add URL builder**

```ts
getWorkflowPlanArtifactUrl: (id: string) => {
  const token = getAuthToken();
  const base = buildApiUrl(`/workflow-runs/${id}/artifacts/plan`);
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
},
```

**Note:** Prefer `Authorization` header in iframe — if iframe cannot set headers, use existing pattern from bug screenshots or add short-lived artifact token in a follow-up. **Slice 1 approach:** fetch HTML via `api.fetchPlanArtifact(id)` returning `string`, render with `srcDoc` on iframe (avoids token-in-URL leak).

```ts
fetchPlanArtifact: async (id: string) => {
  const token = getAuthToken();
  const response = await fetch(buildApiUrl(`/workflow-runs/${id}/artifacts/plan`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Artifact not found');
  return response.text();
},
```

- [ ] **Step 2: UI — when `selectedStage === 'TECHNICAL_PLAN'` and artifact available**

Detect `_artifact` on plan stage output or `artifacts.plan.available`.

State: `planHtml: string | null`, load on stage select.

Render Card below `StageCard`:

```tsx
{planHtml ? (
  <iframe
    title="技术方案预览"
    sandbox=""
    srcDoc={planHtml}
    className="h-[480px] w-full rounded-md border border-border"
  />
) : null}
```

- [ ] **Step 3: Web test**

Extend existing workflow detail test fixture with `_artifact` on TECHNICAL_PLAN output; mock `fetchPlanArtifact` to return `<html>...</html>`; expect iframe / 「方案预览」 label.

- [ ] **Step 4: Run web tests**

Run: `pnpm --filter flowx-web test -- src/pages/WorkflowRunDetailPage.test.tsx`

- [ ] **Step 5: Commit**

---

### Task 7: Verification + docs

**Files:**
- Create: `docs/workflow-artifacts.md` (short operator doc)

- [ ] **Step 1: Document artifact layout and endpoints in `docs/workflow-artifacts.md`**

- [ ] **Step 2: Run full check**

Run: `pnpm check`

Expected: build + all tests pass.

- [ ] **Step 3: Commit docs**

---

## Follow-up plans (not in slice 1)

| Topic | Description |
|-------|-------------|
| `manualEditPlan` | Rewrite `plan.html` + `plan.meta.json` on manual edit |
| Other stages | `brief.html`, `design.html`, `execution/report.html`, … |
| Drop `Plan` table | Read only from artifacts + meta |
| Shrink `StageExecution.output` | Pointer-only after UI migration |
| `manifest.toml` | Replace JSON manifest if desired |
| MCP `flowx_read_artifact` | Read same paths |
| VS Code extension | Open artifact HTML in simple browser |
| Local execution | `claim-local` + `complete-local` updating `execution/report.html` |

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Disk missing on multi-instance API | Document single-node assumption; later object storage |
| Artifact write fails | Log; stage still succeeds with DB-only plan |
| iframe token | Use `srcDoc` + authenticated fetch, not query token |
| Large plan HTML | Unlikely; if needed cap list lengths in template |
| `manualEditPlan` stale HTML | Follow-up task updates files |

---

## Spec coverage self-review

| Requirement | Task |
|-------------|------|
| Per-stage HTML (plan first) | Tasks 1–2, 6 |
| Pointer in stage output | Task 3 |
| manifest + meta sidecar | Task 2 |
| confirmPlan marks confirmed | Task 2–3 |
| runExecution reads meta | Task 4 |
| Web preview | Task 6 |
| JSON validation at AI boundary unchanged | No change to executors |
| Security (template + sandbox) | Tasks 1, 5, 6 |

No placeholders remain in task steps above.

---

## Execution options (after approval)

**Plan file:** `docs/superpowers/plans/2026-06-03-workflow-html-artifacts.md`

1. **Subagent-driven** — one subagent per task, review between tasks.
2. **Inline** — same session, `executing-plans` with checkpoints after Tasks 2, 4, 7.

**Do not start until you confirm.**
