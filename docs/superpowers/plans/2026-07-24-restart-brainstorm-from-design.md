# 设计阶段重新构思 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在工作流详情「产品构思」面板增加「重新构思」按钮，于 `DESIGN_PENDING` / `DESIGN_WAITING_CONFIRMATION` 时一键复用现有 rollback 回到 `BRAINSTORM_PENDING`，便于重新打开本地构思；设计产物保留对照。

**Architecture:** 不新增 API。Web 在 `BRAINSTORM.actions` 条件插入 danger 按钮，确认后调用 `api.rollbackWorkflowToPreviousStage`。后端已支持 DESIGN→BRAINSTORM；补一条 API 测试锁定「新建 PENDING 构思 stage、设计 stage/output 仍在」。手册同步说明入口与保留产物语义。

**Tech Stack:** NestJS `WorkflowService`、React `WorkflowRunDetailPage`、Vitest、既有 `POST /workflow-runs/:id/rollback`

**Spec:** `docs/superpowers/specs/2026-07-24-restart-brainstorm-from-design-design.md`

---

## File map

| File | Responsibility |
| --- | --- |
| `apps/web/src/pages/WorkflowRunDetailPage.tsx` | 「重新构思」按钮、确认文案、rollback + 聚焦构思 |
| `apps/web/src/pages/WorkflowRunDetailPage.test.tsx` | 可见性与点击调用 rollback |
| `apps/web/src/api.ts` | 不改（已有 `rollbackWorkflowToPreviousStage`） |
| `apps/api/src/workflow/workflow-rollback-brainstorm.spec.ts` | DESIGN→BRAINSTORM rollback 行为锁定（新建文件） |
| `docs/user-manual.md` + `apps/web/public/user-manual.md` | 用户可见说明 |
| `docs/local-agent-guide.md` + `apps/web/public/local-agent-guide.md` | 回退后重新打开本地构思一句 |

---

### Task 1: API — DESIGN→BRAINSTORM rollback 回归测试

**Files:**
- Create: `apps/api/src/workflow/workflow-rollback-brainstorm.spec.ts`
- Reference: `apps/api/src/workflow/workflow.service.ts`（`rollbackToPreviousStage` ~911–967，`applyRollbackDataCleanup` ~4916–4948）

- [ ] **Step 1: Write the failing test**

创建 `apps/api/src/workflow/workflow-rollback-brainstorm.spec.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { WorkflowService } from './workflow.service';

const designWorkflow = {
  id: 'workflow-rb-1',
  status: 'DESIGN_PENDING',
  requirementId: 'req-1',
  stageExecutions: [
    {
      id: 'stage-brainstorm-1',
      stage: 'BRAINSTORM',
      status: 'COMPLETED',
      attempt: 1,
      output: { markdown: '# Spec\n\nold' },
    },
    {
      id: 'stage-design-1',
      stage: 'DESIGN',
      status: 'PENDING',
      attempt: 1,
      output: { html: '<div>design</div>' },
    },
  ],
  workflowRepositories: [],
  tasks: [],
  plan: null,
  codeExecution: null,
  reviewReport: null,
  reviewFindings: [],
};

function createService(prisma: Record<string, unknown>) {
  return new WorkflowService(
    prisma as never,
    new WorkflowStateMachine(),
    {} as never,
    {} as never,
    {
      normalizeAiProvider: () => 'codex',
      getConfiguredDefaultProvider: () => 'codex',
    } as never,
    { get: () => ({}) } as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('WorkflowService rollback DESIGN to BRAINSTORM', () => {
  it('creates a new PENDING brainstorm stage and keeps design stage output', async () => {
    const stageExecutionCreate = vi.fn().mockResolvedValue({
      id: 'stage-brainstorm-2',
      stage: 'BRAINSTORM',
      status: 'PENDING',
      attempt: 2,
    });
    const workflowUpdate = vi.fn().mockResolvedValue({});
    const rolledBackWorkflow = {
      ...designWorkflow,
      status: 'BRAINSTORM_PENDING',
      stageExecutions: [
        ...designWorkflow.stageExecutions,
        {
          id: 'stage-brainstorm-2',
          stage: 'BRAINSTORM',
          status: 'PENDING',
          attempt: 2,
          output: null,
        },
      ],
    };

    const tx = {
      reviewFinding: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      reviewReport: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      codeExecution: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      plan: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      task: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      stageExecution: {
        findFirst: vi.fn().mockResolvedValue({ attempt: 1 }),
        create: stageExecutionCreate,
      },
      workflowRun: {
        update: workflowUpdate,
        findUniqueOrThrow: vi.fn().mockResolvedValue(rolledBackWorkflow),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = createService(prisma);
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(designWorkflow);

    const result = await service.rollbackToPreviousStage('workflow-rb-1');

    expect(result.status).toBe('BRAINSTORM_PENDING');
    expect(stageExecutionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stage: 'BRAINSTORM',
          attempt: 2,
          status: 'PENDING',
          statusMessage: '已回退到此阶段，请重新执行',
          input: expect.objectContaining({ source: 'rollback' }),
        }),
      }),
    );
    // 设计 stage / output 未被 delete；cleanup 只清 review/plan/task/codeExecution
    expect(tx.stageExecution).not.toHaveProperty('deleteMany');
    const designStage = result.stageExecutions.find((s) => s.id === 'stage-design-1');
    expect(designStage?.output).toEqual({ html: '<div>design</div>' });
  });
});
```

若 `stage` / `status` 落库字段是映射后的字符串（见 `stageTypeMap` / `stageStatusMap`），按 `createStageExecution` 实际写入值调整 assert（常见为 `'BRAINSTORM'` / `'PENDING'`）。

- [ ] **Step 2: Run test to verify it fails or needs alignment**

Run:

```bash
pnpm --filter flowx-api exec vitest run src/workflow/workflow-rollback-brainstorm.spec.ts
```

Expected: FAIL（文件新建后若实现已满足则可能 PASS——若 PASS，跳到 Step 4，仅保留测试作为回归锁）。若因 prisma 字段映射 / constructor 参数数量失败，先修测试 mock 直至断言语义正确且失败原因是行为缺口（本任务预期后端已满足，测试应在修 mock 后 PASS）。

- [ ] **Step 3: Fix only if rollback 行为不符规格**

仅当测试证明 DESIGN→BRAINSTORM 会清设计产物或未建 PENDING brainstorm 时，才改 `workflow.service.ts`：
- 保持 `applyRollbackDataCleanup` 不删 `stageExecution`
- 保持 `createStageExecution(..., BRAINSTORM, PENDING, source: 'rollback')`

本任务默认**不改** service 实现。

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter flowx-api exec vitest run src/workflow/workflow-rollback-brainstorm.spec.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-rollback-brainstorm.spec.ts
git commit -m "$(cat <<'EOF'
test(api): lock DESIGN rollback back to brainstorm without clearing design

EOF
)"
```

---

### Task 2: Web — 「重新构思」按钮与交互

**Files:**
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`（`BRAINSTORM.actions` ~1516–1557；可复用 `runAction` ~984–1008）
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`（mock `rollbackWorkflowToPreviousStage`；新增用例）

- [ ] **Step 1: Write the failing Web tests**

在 `vi.mock('../api')` 的 `api` 对象中增加：

```typescript
rollbackWorkflowToPreviousStage: vi.fn(),
```

在 `WorkflowRunDetailPage.test.tsx` 增加用例（放在 brainstorm 相关 describe/it 附近）：

```typescript
async function selectBrainstormStep() {
  const stepButton = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('产品构思'),
  );
  expect(stepButton).toBeTruthy();
  await act(async () => {
    stepButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}

it('shows restart brainstorm on the brainstorm stage when workflow is in design', async () => {
  vi.mocked(api.getWorkflowRun).mockResolvedValue(
    createWorkflowRun({
      status: 'DESIGN_PENDING',
      stageExecutions: [
        {
          id: 'stage-brainstorm',
          stage: 'BRAINSTORM',
          status: 'COMPLETED',
          statusMessage: null,
          attempt: 1,
          output: { markdown: '# Spec' },
        },
        {
          id: 'stage-design',
          stage: 'DESIGN',
          status: 'PENDING',
          statusMessage: '可生成设计方案，也可以跳过设计继续',
          attempt: 1,
          output: null,
        },
      ],
    }),
  );

  await renderPage();
  await selectBrainstormStep();

  const restartButton = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('重新构思'),
  );
  expect(restartButton).toBeTruthy();
  expect(restartButton?.disabled).toBe(false);
});

it('hides restart brainstorm when workflow is in brainstorm pending', async () => {
  vi.mocked(api.getWorkflowRun).mockResolvedValue(
    createWorkflowRun({
      status: 'BRAINSTORM_PENDING',
      stageExecutions: [
        {
          id: 'stage-brainstorm',
          stage: 'BRAINSTORM',
          status: 'PENDING',
          statusMessage: '可生成产品简报，也可以跳过构思继续',
          attempt: 1,
          output: null,
        },
      ],
    }),
  );

  await renderPage();

  const restartButton = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('重新构思'),
  );
  expect(restartButton).toBeFalsy();
});

it('calls rollback when restart brainstorm is confirmed', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.mocked(api.getWorkflowRun).mockResolvedValue(
    createWorkflowRun({
      status: 'DESIGN_WAITING_CONFIRMATION',
      stageExecutions: [
        {
          id: 'stage-brainstorm',
          stage: 'BRAINSTORM',
          status: 'COMPLETED',
          statusMessage: null,
          attempt: 1,
          output: { markdown: '# Spec' },
        },
        {
          id: 'stage-design',
          stage: 'DESIGN',
          status: 'WAITING_CONFIRMATION',
          statusMessage: null,
          attempt: 1,
          output: { html: '<div/>' },
        },
      ],
    }),
  );
  vi.mocked(api.rollbackWorkflowToPreviousStage).mockResolvedValue(
    createWorkflowRun({
      status: 'BRAINSTORM_PENDING',
      stageExecutions: [
        {
          id: 'stage-brainstorm-2',
          stage: 'BRAINSTORM',
          status: 'PENDING',
          statusMessage: '已回退到此阶段，请重新执行',
          attempt: 2,
          output: null,
        },
      ],
    }),
  );

  await renderPage();
  await selectBrainstormStep();

  const restartButton = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('重新构思'),
  );
  await act(async () => {
    restartButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });

  expect(window.confirm).toHaveBeenCalledWith(
    '将回到产品构思并重新编写规格；已有设计产物会保留供对照。',
  );
  expect(api.rollbackWorkflowToPreviousStage).toHaveBeenCalledWith('workflow-1');
});
```

确认 `createWorkflowRun` 默认 `id` 为 `'workflow-1'`（与现有用例一致）；若不同，改 assert 中的 id。

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter flowx-web exec vitest run src/pages/WorkflowRunDetailPage.test.tsx
```

Expected: FAIL（找不到「重新构思」或未 mock 的 rollback）

- [ ] **Step 3: Implement the button**

在 `WorkflowRunDetailPage.tsx` 的 `BRAINSTORM.actions` 数组末尾（「跳过构思」之后）条件插入：

```typescript
...(workflowRun.status === 'DESIGN_PENDING' ||
workflowRun.status === 'DESIGN_WAITING_CONFIRMATION'
  ? [
      {
        key: 'restart-brainstorm',
        label: '重新构思',
        danger: true as const,
        disabled: stageActionsLocked,
        loading: busyStage === 'BRAINSTORM',
        onClick: () => {
          const confirmed = window.confirm(
            '将回到产品构思并重新编写规格；已有设计产物会保留供对照。',
          );
          if (!confirmed) {
            return;
          }
          void runAction(
            'BRAINSTORM',
            () => api.rollbackWorkflowToPreviousStage(workflowRun.id),
            '已回到产品构思，可重新打开本地构思',
            { focusNextStage: true },
          );
        },
      },
    ]
  : []),
```

注意：
- `BRAINSTORM_PENDING` 时不插入该按钮（规格：hidden）
- 页头「回退到上一阶段」不动
- 用户需先点步骤条「产品构思」才看到该按钮（与「按钮在产品构思面板」一致）

- [ ] **Step 4: Run Web tests to verify they pass**

Run:

```bash
pnpm --filter flowx-web exec vitest run src/pages/WorkflowRunDetailPage.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/WorkflowRunDetailPage.tsx apps/web/src/pages/WorkflowRunDetailPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): add restart brainstorm action on design-stage workflows

EOF
)"
```

---

### Task 3: 文档同步

**Files:**
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`（与源文件一致）
- Modify: `docs/local-agent-guide.md`
- Modify: `apps/web/public/local-agent-guide.md`

- [ ] **Step 1: Update user-manual**

在「在工作流详情推进每个阶段」中，把产品构思相关描述改为包含重新构思，例如将第 2 点改为：

```markdown
2. 产品构思：本地构思或 AI 生成产品规格，可跳过；若已进入设计阶段，可在「产品构思」面板点击「重新构思」回到构思（设计产物保留对照），再打开本地构思重写规格
```

在「各阶段你可以进行的常见操作」列表中增加一条：

```markdown
- 重新构思（设计阶段时，在产品构思面板将工作流退回构思并保留设计产物）
```

同步复制到 `apps/web/public/user-manual.md`（或整文件覆盖，保证一致）。

- [ ] **Step 2: Update local-agent-guide**

在「### 4.2 OpenDesign 本地构思与设计」的**产品构思**列表后增加：

```markdown
5. 若已进入设计阶段仍要改规格：在工作流详情切到「产品构思」，点「重新构思」，确认后再点「打开本地构思」
```

同步 `apps/web/public/local-agent-guide.md`。

- [ ] **Step 3: Verify mirrors**

Run:

```bash
cmp -s docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
```

Expected: 无输出、exit 0

- [ ] **Step 4: Commit**

```bash
git add docs/user-manual.md apps/web/public/user-manual.md docs/local-agent-guide.md apps/web/public/local-agent-guide.md
git commit -m "$(cat <<'EOF'
docs: document restart brainstorm from design stage

EOF
)"
```

---

### Task 4: 收尾验证

- [ ] **Step 1: Run focused tests**

```bash
pnpm --filter flowx-api exec vitest run src/workflow/workflow-rollback-brainstorm.spec.ts
pnpm --filter flowx-web exec vitest run src/pages/WorkflowRunDetailPage.test.tsx
```

Expected: 全部 PASS

- [ ] **Step 2: Optional full check if touching shared types**

本变更未改 Prisma / 共享协议时，不必强制 `pnpm check`；若本地方便可跑：

```bash
pnpm --filter flowx-web test
pnpm --filter flowx-api test
```

- [ ] **Step 3: Manual smoke（可选）**

1. 工作流进入 `DESIGN_PENDING` 或 `DESIGN_WAITING_CONFIRMATION`
2. 步骤条点「产品构思」→ 见「重新构思」
3. 确认 → 状态变 `BRAINSTORM_PENDING` → 「打开本地构思」可用
4. 设计面板旧产物仍可对照

---

## Spec coverage checklist

| Spec 要求 | Task |
| --- | --- |
| 仅 DESIGN_* 触发 | Task 2 条件插入按钮 |
| 入口在产品构思 actions | Task 2 |
| 文案「重新构思」、danger | Task 2 |
| 复用 rollback API | Task 2 + Task 1 |
| 设计产物保留 | Task 1 断言 + 不改 cleanup |
| 不自动拉起本地 IDE | Task 2（仅 toast + 聚焦） |
| Demo 及更后不做 | 无对应任务（YAGNI） |
| 用户手册 + 本地指南 | Task 3 |
| Web/API 测试 | Task 1、2 |

## Placeholder / consistency self-review

- 无 TBD；API 路径与前端 helper 名与现网一致：`rollbackWorkflowToPreviousStage` → `POST .../rollback`
- 确认文案与 toast 与 spec 一字对齐
- `createWorkflowRun` / workflow id 以测试文件现状为准，实现时核对
