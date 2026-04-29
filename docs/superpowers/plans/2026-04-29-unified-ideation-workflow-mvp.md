# Unified Ideation Workflow MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first usable unified workflow path where repository grounding is first, brainstorm/design/demo appear as workflow stages, and optional ideation stages can be skipped to continue into task split.

**Architecture:** Keep `WorkflowRun` and `StageExecution` as the source of truth for the MVP. Add workflow statuses and stage types for brainstorm, design, and demo, plus `SKIPPED` stage execution status. The first implementation wires skip endpoints and frontend stage cards; AI generation endpoints can be added after this skeleton is verified.

**Tech Stack:** NestJS, Prisma, Vitest, React, Vite, TypeScript.

---

### Task 1: Extend Workflow State Machine

**Files:**
- Modify: `apps/api/src/common/enums.ts`
- Modify: `apps/api/src/common/workflow-state-machine.ts`
- Test: `apps/api/src/common/workflow-state-machine.spec.ts`

- [ ] **Step 1: Write failing state-machine tests**

Add tests asserting:

```ts
it('routes repository grounding into brainstorm before task split', () => {
  const machine = new WorkflowStateMachine();
  expect(machine.canTransitionWorkflow(
    WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING,
    WorkflowRunStatus.BRAINSTORM_PENDING,
  )).toBe(true);
  expect(machine.canTransitionWorkflow(
    WorkflowRunStatus.REPOSITORY_GROUNDING_PENDING,
    WorkflowRunStatus.TASK_SPLIT_PENDING,
  )).toBe(false);
});

it('allows optional ideation stages to advance through demo into task split', () => {
  const machine = new WorkflowStateMachine();
  expect(machine.canTransitionWorkflow(WorkflowRunStatus.BRAINSTORM_PENDING, WorkflowRunStatus.DESIGN_PENDING)).toBe(true);
  expect(machine.canTransitionWorkflow(WorkflowRunStatus.DESIGN_PENDING, WorkflowRunStatus.DEMO_PENDING)).toBe(true);
  expect(machine.canTransitionWorkflow(WorkflowRunStatus.DEMO_PENDING, WorkflowRunStatus.TASK_SPLIT_PENDING)).toBe(true);
});

it('allows pending optional stage executions to be skipped', () => {
  const machine = new WorkflowStateMachine();
  expect(machine.canTransitionStage(StageExecutionStatus.PENDING, StageExecutionStatus.SKIPPED)).toBe(true);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter flowx-api test -- src/common/workflow-state-machine.spec.ts`

Expected: failures because the new enum values do not exist.

- [ ] **Step 3: Add enum values and transitions**

Add workflow statuses:

```ts
BRAINSTORM_PENDING = 'brainstorm_pending',
DESIGN_PENDING = 'design_pending',
DEMO_PENDING = 'demo_pending',
```

Add stage types:

```ts
BRAINSTORM = 'brainstorm',
DESIGN = 'design',
DEMO = 'demo',
```

Add stage status:

```ts
SKIPPED = 'skipped',
```

Wire transitions:

```ts
REPOSITORY_GROUNDING_PENDING -> BRAINSTORM_PENDING | FAILED
BRAINSTORM_PENDING -> DESIGN_PENDING | FAILED
DESIGN_PENDING -> DEMO_PENDING | FAILED
DEMO_PENDING -> TASK_SPLIT_PENDING | FAILED
PENDING -> RUNNING | SKIPPED
FAILED -> SKIPPED
```

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter flowx-api test -- src/common/workflow-state-machine.spec.ts`

Expected: all workflow state-machine tests pass.

### Task 2: Add Workflow Skip Backend

**Files:**
- Modify: `apps/api/src/workflow/workflow.service.ts`
- Modify: `apps/api/src/workflow/workflow.controller.ts`
- Test: `apps/api/src/workflow/workflow.service.spec.ts`

- [ ] **Step 1: Write failing service tests**

Add tests for private pure helpers where possible:

```ts
it('builds a standard skipped optional stage output', () => {
  const service = createService();
  expect((service as any).buildSkippedStageOutput('User chose to skip design.')).toEqual({
    skipped: true,
    source: 'user',
    reason: 'User chose to skip design.',
  });
});
```

Add transition tests around `WorkflowStateMachine` coverage instead of heavy Prisma mocks.

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter flowx-api test -- src/workflow/workflow.service.spec.ts`

Expected: failure because `buildSkippedStageOutput` does not exist.

- [ ] **Step 3: Implement workflow mappings and skip action**

Update `workflowStatusMap` and `stageTypeMap` for `BRAINSTORM`, `DESIGN`, and `DEMO`.

Add `stageStatusMap[StageExecutionStatus.SKIPPED] = 'SKIPPED'`.

Add:

```ts
async skipOptionalStage(id: string, stage: StageType) {
  // Allow only BRAINSTORM, DESIGN, DEMO.
  // Find the current workflow.
  // Assert no running stage.
  // Create a PENDING stage execution for the optional stage if none exists.
  // Update it to SKIPPED with buildSkippedStageOutput.
  // Transition workflow to the next pending status.
  // Return updated workflow.
}
```

Add wrappers:

```ts
skipBrainstorm(id: string) { return this.skipOptionalStage(id, StageType.BRAINSTORM); }
skipDesign(id: string) { return this.skipOptionalStage(id, StageType.DESIGN); }
skipDemo(id: string) { return this.skipOptionalStage(id, StageType.DEMO); }
```

When repository grounding completes, transition from `REPOSITORY_GROUNDING_PENDING` to `BRAINSTORM_PENDING`.

- [ ] **Step 4: Add controller endpoints**

Add:

```ts
@Post(':id/brainstorm/skip')
skipBrainstorm(@Param('id') id: string) {
  return this.workflowService.skipBrainstorm(id);
}
```

Repeat for `design/skip` and `demo/skip`.

- [ ] **Step 5: Run focused backend tests**

Run: `pnpm --filter flowx-api test -- src/common/workflow-state-machine.spec.ts src/workflow/workflow.service.spec.ts`

Expected: tests pass except unrelated existing failures outside these files.

### Task 3: Update Web API and Workflow Stage UI

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/utils/workflow-ui.ts`
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`
- Test: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`

- [ ] **Step 1: Write failing page test**

Add a test that renders workflow status `BRAINSTORM_PENDING` and expects:

```ts
expect(text).toContain('产品构思');
expect(text).toContain('跳过构思');
expect(text).toContain('设计方案');
expect(text).toContain('Demo 页面');
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm --filter flowx-web test -- src/pages/WorkflowRunDetailPage.test.tsx`

Expected: failure because the ideation stages are not rendered.

- [ ] **Step 3: Add API methods**

Add:

```ts
skipBrainstorm: (id: string) => request<WorkflowRun>(`/workflow-runs/${id}/brainstorm/skip`, { method: 'POST' }),
skipDesign: (id: string) => request<WorkflowRun>(`/workflow-runs/${id}/design/skip`, { method: 'POST' }),
skipDemo: (id: string) => request<WorkflowRun>(`/workflow-runs/${id}/demo/skip`, { method: 'POST' }),
```

- [ ] **Step 4: Render new stages**

Extend `STAGE_SEQUENCE`:

```ts
['REPOSITORY_GROUNDING', 'BRAINSTORM', 'DESIGN', 'DEMO', 'TASK_SPLIT', 'TECHNICAL_PLAN', 'EXECUTION', 'AI_REVIEW']
```

Add stage metadata for:

```ts
BRAINSTORM: '产品构思'
DESIGN: '设计方案'
DEMO: 'Demo 页面'
```

Add stage cards with skip buttons enabled only when workflow status matches the stage pending status and no stage is running.

- [ ] **Step 5: Run focused web test**

Run: `pnpm --filter flowx-web test -- src/pages/WorkflowRunDetailPage.test.tsx`

Expected: the new test passes.

### Task 4: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run required API tests**

Run: `pnpm --filter flowx-api test`

Expected: note any pre-existing failures separately from new failures.

- [ ] **Step 2: Run required web tests**

Run: `pnpm --filter flowx-web test`

Expected: note any pre-existing failures separately from new failures.

- [ ] **Step 3: Run project check**

Run: `pnpm check`

Expected: build passes; tests may still include previously observed unrelated failures if not fixed in this implementation.

