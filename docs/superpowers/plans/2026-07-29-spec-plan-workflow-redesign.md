# 去掉 Demo、合并 Spec & Plan — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 硬移除工作流/需求 Demo 阶段；将任务拆解与技术方案合并为单一不可跳过的 Spec & Plan 闸门；删除 Prisma `Task`/`Plan` 及全部旧 API，无兼容层。

**Architecture:** 状态机与枚举以 `SPEC_PLAN_*` 替换 `DEMO_*` + `TASK_SPLIT_*` + `PLAN_*`。产物只存 `StageExecution.output`（`spec` + `plan` + 可选 `notes`）。AIExecutor 用单一 `generateSpecPlan` 替换 `splitTasks`/`generatePlan`。执行与本地 handoff 改读 Spec&Plan output。Web / Cursor Extension / 文档同步硬切。

**Tech Stack:** NestJS, Prisma/SQLite, Vitest, React 19, 现有 WorkflowStateMachine + AIExecutor。

**Spec:** `docs/superpowers/specs/2026-07-29-spec-plan-workflow-redesign.md`

---

## File map

| 文件 | 职责 |
|------|------|
| `apps/api/src/common/enums.ts` | 删 DEMO/TASK_SPLIT/PLAN 状态；加 `SPEC_PLAN_*`；删 `TaskStatus`/`PlanStatus`；清 `IdeationStatus.DEMO_*` |
| `apps/api/src/common/workflow-state-machine.ts` | 新转移图；`assertStageMatchesWorkflow` |
| `apps/api/src/common/workflow-state-machine.spec.ts` | 状态机测试重写 |
| `apps/api/src/common/types.ts` | `SpecPlan*` 类型；`ExecuteTaskInput`/`ReviewCodeInput` 改吃 SpecPlan |
| `apps/api/src/ai/ai-executor.ts` | `generateSpecPlan`；删除 `splitTasks`/`generatePlan` |
| `apps/api/src/ai/spec-plan.output.schema.json` | **新建** |
| `apps/api/src/prompts/spec-plan.prompt.ts` | **新建** |
| `apps/api/src/ai/mock-ai.executor.ts` / `codex-ai.executor.ts` | 实现 `generateSpecPlan`；删旧方法 |
| `apps/api/src/ai/task-split.*` / `technical-plan.*` / 对应 prompt | **删除** |
| `prisma/schema.prisma` | 删 `Task`/`Plan` 与 `WorkflowRun` 关系 |
| `scripts/clean-db.ts` | 去掉 task/plan delete |
| `apps/api/src/workflow/workflow-status-migration.ts` | **新建** — 启动时一次性 status 映射 |
| `apps/api/src/workflow/workflow.service.ts` | 删 demo/task-split/plan；加 spec-plan；设计确认→SPEC_PLAN；执行读 output |
| `apps/api/src/workflow/workflow.controller.ts` | 只留 `/spec-plan/*` |
| `apps/api/src/workflow/bug-fix-workflow.bootstrap.ts` | 跳过列表与合成 SpecPlan |
| `apps/api/src/workflow/workflow-local-handoff.ts` | payload 去掉 tasks/plan 表形状 |
| `apps/api/src/workflow/workflow-artifact.service.ts` | plan HTML 改为 spec-plan 文档产物（或内联 markdown 展示，见 Task 5） |
| `apps/api/src/requirements/*` | 硬删 demo 生成/确认/恢复 |
| `apps/web/src/api.ts` / `types.ts` / `utils/workflow-ui.ts` | 客户端硬切 |
| `apps/web/src/pages/WorkflowRunDetailPage.tsx` | 阶段条与 Spec&Plan UI |
| `apps/web/src/components/IdeationDesignPanel.tsx` 等 | 去掉需求侧 Demo |
| `apps/cursor-extension/src/*` | demo/task-split/plan → spec-plan |
| `docs/user-manual.md` + public 镜像、`README.md`、`docs/system-design.md` | 用户可见文档 |

---

### Task 1: 枚举与状态机（TDD）

**Files:**
- Modify: `apps/api/src/common/enums.ts`
- Modify: `apps/api/src/common/workflow-state-machine.ts`
- Modify: `apps/api/src/common/workflow-state-machine.spec.ts`

- [ ] **Step 1: 重写失败测试**

替换 `workflow-state-machine.spec.ts` 中涉及 DEMO / TASK_SPLIT / PLAN 的用例为：

```typescript
it('routes design through waiting confirmation into spec plan, then execution', () => {
  const machine = new WorkflowStateMachine();

  expect(
    machine.canTransitionWorkflow(
      WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION,
      WorkflowRunStatus.SPEC_PLAN_PENDING,
    ),
  ).toBe(true);
  expect(
    machine.canTransitionWorkflow(
      WorkflowRunStatus.DESIGN_PENDING,
      WorkflowRunStatus.SPEC_PLAN_PENDING,
    ),
  ).toBe(true);
  expect(
    machine.canTransitionWorkflow(
      WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION,
      WorkflowRunStatus.DEMO_PENDING as WorkflowRunStatus,
    ),
  ).toBe(false);
  expect(
    machine.canTransitionWorkflow(
      WorkflowRunStatus.SPEC_PLAN_PENDING,
      WorkflowRunStatus.SPEC_PLAN_WAITING_CONFIRMATION,
    ),
  ).toBe(true);
  expect(
    machine.canTransitionWorkflow(
      WorkflowRunStatus.SPEC_PLAN_WAITING_CONFIRMATION,
      WorkflowRunStatus.SPEC_PLAN_CONFIRMED,
    ),
  ).toBe(true);
  expect(
    machine.canTransitionWorkflow(
      WorkflowRunStatus.SPEC_PLAN_CONFIRMED,
      WorkflowRunStatus.EXECUTION_PENDING,
    ),
  ).toBe(true);
});

it('does not allow skipping from design directly to execution', () => {
  const machine = new WorkflowStateMachine();
  expect(
    machine.canTransitionWorkflow(
      WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION,
      WorkflowRunStatus.EXECUTION_PENDING,
    ),
  ).toBe(false);
});
```

（Step 1 写完后先跑：此时旧枚举仍在，`SPEC_PLAN_*` 不存在 → 编译/测试失败。）

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter flowx-api exec vitest run src/common/workflow-state-machine.spec.ts
```

Expected: FAIL（`SPEC_PLAN_*` 不存在或旧断言仍失败）

- [ ] **Step 3: 更新 `enums.ts`**

`WorkflowRunStatus`：删除全部 `DEMO_*`、`TASK_SPLIT_*`、`PLAN_*`；新增：

```typescript
SPEC_PLAN_PENDING = 'spec_plan_pending',
SPEC_PLAN_WAITING_CONFIRMATION = 'spec_plan_waiting_confirmation',
SPEC_PLAN_CONFIRMED = 'spec_plan_confirmed',
```

`StageType`：删除 `DEMO`、`TASK_SPLIT`、`TECHNICAL_PLAN`；新增 `SPEC_PLAN = 'spec_plan'`。

删除 `TaskStatus`、`PlanStatus`。

`IdeationStatus`：删除 `DEMO_PENDING`、`DEMO_WAITING_CONFIRMATION`、`DEMO_CONFIRMED`；`DESIGN_CONFIRMED` 后可直接 `FINALIZED`（与 requirements 服务 Task 8 对齐）。

- [ ] **Step 4: 重写 `workflow-state-machine.ts` 转移**

要点：

```typescript
[WorkflowRunStatus.DESIGN_PENDING]: [
  WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION,
  WorkflowRunStatus.SPEC_PLAN_PENDING,
  WorkflowRunStatus.BRAINSTORM_PENDING,
  WorkflowRunStatus.FAILED,
],
[WorkflowRunStatus.DESIGN_WAITING_CONFIRMATION]: [
  WorkflowRunStatus.SPEC_PLAN_PENDING,
  WorkflowRunStatus.DESIGN_PENDING,
  WorkflowRunStatus.BRAINSTORM_PENDING,
  WorkflowRunStatus.FAILED,
],
[WorkflowRunStatus.SPEC_PLAN_PENDING]: [
  WorkflowRunStatus.SPEC_PLAN_WAITING_CONFIRMATION,
  WorkflowRunStatus.DESIGN_PENDING,
  WorkflowRunStatus.FAILED,
],
[WorkflowRunStatus.SPEC_PLAN_WAITING_CONFIRMATION]: [
  WorkflowRunStatus.SPEC_PLAN_CONFIRMED,
  WorkflowRunStatus.SPEC_PLAN_PENDING,
  WorkflowRunStatus.DESIGN_PENDING,
  WorkflowRunStatus.FAILED,
],
[WorkflowRunStatus.SPEC_PLAN_CONFIRMED]: [
  WorkflowRunStatus.EXECUTION_PENDING,
  WorkflowRunStatus.SPEC_PLAN_PENDING,
],
[WorkflowRunStatus.EXECUTION_PENDING]: [
  WorkflowRunStatus.EXECUTION_RUNNING,
  WorkflowRunStatus.SPEC_PLAN_PENDING,
  WorkflowRunStatus.FAILED,
],
[WorkflowRunStatus.EXECUTION_RUNNING]: [
  WorkflowRunStatus.REVIEW_PENDING,
  WorkflowRunStatus.EXECUTION_PENDING,
  WorkflowRunStatus.SPEC_PLAN_PENDING,
  WorkflowRunStatus.FAILED,
],
```

`rollbackTargets` 用 `SPEC_PLAN_PENDING` 替换 DEMO/TASK_SPLIT/PLAN。

`assertStageMatchesWorkflow`：`StageType.SPEC_PLAN` 匹配三个 `SPEC_PLAN_*` status。

- [ ] **Step 5: 跑测试通过**

```bash
pnpm --filter flowx-api exec vitest run src/common/workflow-state-machine.spec.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/common/enums.ts apps/api/src/common/workflow-state-machine.ts apps/api/src/common/workflow-state-machine.spec.ts
git commit -m "feat(api): replace demo/task-split/plan statuses with SPEC_PLAN"
```

---

### Task 2: SpecPlan 类型、schema、prompt、AIExecutor

**Files:**
- Modify: `apps/api/src/common/types.ts`
- Create: `apps/api/src/ai/spec-plan.output.schema.json`
- Create: `apps/api/src/prompts/spec-plan.prompt.ts`
- Modify: `apps/api/src/ai/ai-executor.ts`
- Modify: `apps/api/src/ai/mock-ai.executor.ts`
- Modify: `apps/api/src/ai/codex-ai.executor.ts`
- Delete: `apps/api/src/ai/task-split.output.schema.json`
- Delete: `apps/api/src/ai/technical-plan.output.schema.json`
- Delete: `apps/api/src/prompts/task-split.prompt.ts`
- Delete: `apps/api/src/prompts/technical-plan.prompt.ts`
- Modify/Delete: 依赖旧类型的 `*.spec.ts`

- [ ] **Step 1: 在 `types.ts` 定义并替换消费方类型**

```typescript
export interface SpecPlanSpec {
  goal: string;
  scope: string[];
  nonGoals: string[];
  acceptanceCriteria: string[];
  constraints: string[];
}

export interface SpecPlanPlan {
  approach: string;
  touchpoints: string[];
  sequence: string[];
  risks: string[];
  verification: string[];
}

export interface SpecPlanNotes {
  checklist?: string[];
  openQuestions?: string[];
}

export interface SpecPlanOutput {
  spec: SpecPlanSpec;
  plan: SpecPlanPlan;
  notes?: SpecPlanNotes;
}

export interface GenerateSpecPlanInput {
  requirement: RequirementRecord;
  workspace?: WorkspaceContext | null;
  humanFeedback?: string | null;
  previousOutput?: SpecPlanOutput | null;
  brainstormContext?: unknown | null;
  designContext?: unknown | null;
}

export interface ExecuteTaskInput {
  requirement: RequirementRecord;
  specPlan: SpecPlanOutput;
  workspace?: WorkspaceContext | null;
  humanFeedback?: string | null;
}

export interface ReviewCodeInput {
  requirement: RequirementRecord;
  specPlan: SpecPlanOutput;
  execution: ExecuteTaskOutput;
  workspace?: WorkspaceContext | null;
  humanFeedback?: string | null;
}
```

删除 `SplitTasks*`、`GeneratePlan*`、`demoPageContext` 字段。

- [ ] **Step 2: 新建 schema**

`apps/api/src/ai/spec-plan.output.schema.json`：`required: ["spec","plan"]`；`spec`/`plan` 字段与上表一致；`notes` optional；`additionalProperties: false`。

- [ ] **Step 3: 新建 prompt**

`apps/api/src/prompts/spec-plan.prompt.ts`：中文系统提示 — 产出实现边界（spec）与实现路径（plan）；文档为主；不要强制 tasks 列表；禁止再生成仓库 Demo 页。

- [ ] **Step 4: 改 `AIExecutor` 接口**

```typescript
generateSpecPlan(input: GenerateSpecPlanInput, context?: AIInvocationContext): Promise<SpecPlanOutput>;
```

删除 `splitTasks`、`generatePlan`。

- [ ] **Step 5: Mock 实现**

```typescript
async generateSpecPlan(input: GenerateSpecPlanInput): Promise<SpecPlanOutput> {
  return {
    spec: {
      goal: input.requirement.title,
      scope: [input.requirement.description ?? '实现已确认需求'],
      nonGoals: ['本阶段不扩展无关功能'],
      acceptanceCriteria: ['核心路径可用', '关键验收可验证'],
      constraints: [],
    },
    plan: {
      approach: '按 Spec 在目标仓库落地最小可合并改动',
      touchpoints: [],
      sequence: ['阅读 Spec', '实现', '本地验证'],
      risks: [],
      verification: ['对照 acceptanceCriteria 自检'],
    },
    notes: { checklist: [], openQuestions: [] },
  };
}
```

- [ ] **Step 6: Codex/Cursor**

用现有 `runJsonStage` 模式调用 `spec-plan.output.schema.json` + `specPlanPrompt`；删除 `buildTaskSplitPrompt` / `buildTechnicalPlanPrompt` / `assertSplitTasksOutput` 等。

- [ ] **Step 7: 跑 AI 相关测试并修到绿**

```bash
pnpm --filter flowx-api exec vitest run src/ai/
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/common/types.ts apps/api/src/ai apps/api/src/prompts
git commit -m "feat(api): add generateSpecPlan and remove splitTasks/generatePlan"
```

---

### Task 3: Prisma 删除 Task/Plan + status 迁移

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `scripts/clean-db.ts`
- Create: `apps/api/src/workflow/workflow-status-migration.ts`
- Create: `apps/api/src/workflow/workflow-status-migration.spec.ts`
- Wire: `apps/api/src/app.module.ts` 或 `main.ts` / WorkflowModule `onModuleInit`

- [ ] **Step 1: 写迁移映射单测**

```typescript
import { mapLegacyWorkflowStatus } from './workflow-status-migration';

it('maps demo and plan statuses to SPEC_PLAN', () => {
  expect(mapLegacyWorkflowStatus('demo_pending')).toBe('spec_plan_pending');
  expect(mapLegacyWorkflowStatus('demo_waiting_confirmation')).toBe('spec_plan_pending');
  expect(mapLegacyWorkflowStatus('task_split_pending')).toBe('spec_plan_pending');
  expect(mapLegacyWorkflowStatus('task_split_waiting_confirmation')).toBe(
    'spec_plan_waiting_confirmation',
  );
  expect(mapLegacyWorkflowStatus('task_split_confirmed')).toBe('spec_plan_confirmed');
  expect(mapLegacyWorkflowStatus('plan_pending')).toBe('spec_plan_pending');
  expect(mapLegacyWorkflowStatus('plan_waiting_confirmation')).toBe(
    'spec_plan_waiting_confirmation',
  );
  expect(mapLegacyWorkflowStatus('plan_confirmed')).toBe('spec_plan_confirmed');
  expect(mapLegacyWorkflowStatus('execution_pending')).toBe('execution_pending');
});
```

- [ ] **Step 2: 实现 `mapLegacyWorkflowStatus` + `migrateWorkflowStatuses(prisma)`**

```typescript
const STATUS_MAP: Record<string, string> = {
  demo_pending: 'spec_plan_pending',
  demo_waiting_confirmation: 'spec_plan_pending',
  task_split_pending: 'spec_plan_pending',
  task_split_waiting_confirmation: 'spec_plan_waiting_confirmation',
  task_split_confirmed: 'spec_plan_confirmed',
  plan_pending: 'spec_plan_pending',
  plan_waiting_confirmation: 'spec_plan_waiting_confirmation',
  plan_confirmed: 'spec_plan_confirmed',
};

export function mapLegacyWorkflowStatus(status: string): string {
  return STATUS_MAP[status] ?? status;
}

export async function migrateWorkflowStatuses(prisma: PrismaClient): Promise<number> {
  const runs = await prisma.workflowRun.findMany({ select: { id: true, status: true, currentStage: true } });
  let updated = 0;
  for (const run of runs) {
    const status = mapLegacyWorkflowStatus(run.status);
    const currentStage =
      run.currentStage === 'demo' ||
      run.currentStage === 'task_split' ||
      run.currentStage === 'technical_plan'
        ? 'spec_plan'
        : run.currentStage;
    if (status !== run.status || currentStage !== run.currentStage) {
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: { status, currentStage },
      });
      updated += 1;
    }
  }
  return updated;
}
```

在 WorkflowModule（或 API bootstrap）`onModuleInit` 调用一次。

- [ ] **Step 3: 从 schema 删除模型**

删除 `model Task`、`model Plan`；从 `WorkflowRun` 删除 `tasks Task[]`、`plan Plan?`。

- [ ] **Step 4: 更新 `scripts/clean-db.ts`**

去掉 `tx.plan.deleteMany()` / `tx.task.deleteMany()`。

- [ ] **Step 5: 生成 client 并 push**

```bash
pnpm prisma:generate
pnpm --filter flowx-api exec prisma db push --schema ../../prisma/schema.prisma
```

Expected: 表 `Task`/`Plan` 被丢弃（开发库可接受；生产先备份）。

- [ ] **Step 6: 跑迁移单测**

```bash
pnpm --filter flowx-api exec vitest run src/workflow/workflow-status-migration.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma scripts/clean-db.ts apps/api/src/workflow/workflow-status-migration.ts apps/api/src/workflow/workflow-status-migration.spec.ts apps/api/src/app.module.ts apps/api/src/workflow/workflow.module.ts
git commit -m "feat(api): drop Task/Plan models and migrate workflow statuses"
```

---

### Task 4: Workflow service — Spec & Plan 编排（删 Demo/拆解/方案）

**Files:**
- Modify: `apps/api/src/workflow/workflow.service.ts`
- Modify: `apps/api/src/workflow/workflow.controller.ts`
- Modify: `apps/api/src/workflow/workflow.service.spec.ts`（及相关 hook spec）

- [ ] **Step 1: 先改测试期望**

在 `workflow.service.spec.ts` 等把：

- 设计确认后期望 `DEMO_PENDING` → `SPEC_PLAN_PENDING`
- 本地设计完成后期望 `TASK_SPLIT_PENDING` → `SPEC_PLAN_PENDING`
- 删除/改写 demo rerun、task create、plan upsert 断言

- [ ] **Step 2: 更新 maps**

`workflowStatusMap` / `stageTypeMap` 只保留 `SPEC_PLAN_*` / `SPEC_PLAN`。

- [ ] **Step 3: 改 `confirmDesign` / `skipOptionalStage`**

设计确认或跳过 → 创建 `StageType.SPEC_PLAN` pending，workflow → `SPEC_PLAN_PENDING`。删除 DEMO stage 创建。

`resolveOptionalStageSkipTarget`：去掉 DEMO 分支；DESIGN → `SPEC_PLAN_PENDING`。Spec & Plan **不提供 skip 方法**。

- [ ] **Step 4: 实现 `runSpecPlan` / `confirmSpecPlan` / `rejectSpecPlan` / `manualEditSpecPlan`**

行为对齐旧 `runTaskSplit`+`runPlan`，但：

- 调用 `this.aiExecutor.generateSpecPlan(...)`
- 上下文：grounding + brainstorm + design；**不**调 `getWorkflowDemoContext`
- 只写 `StageExecution.output`，**不**写 `prisma.task` / `prisma.plan`
- 成功后 `SPEC_PLAN_WAITING_CONFIRMATION`
- `confirmSpecPlan`：`SPEC_PLAN_CONFIRMED` → `EXECUTION_PENDING`
- 删除：`runDemo`、`confirmDemo`、`skipDemo`、`runTaskSplit`、`confirmTaskSplit`、`rejectTaskSplit`、`manualEditTaskSplit`、`runPlan`、`confirmPlan`、`rejectPlan`、`manualEditPlan`、`resolveConfirmedPlan`（改为 `resolveConfirmedSpecPlan` 读最新 COMPLETED/CONFIRMED 的 SPEC_PLAN output）、`writeWorkflowDemoPagesToRepo`、`canRunDemoFromWorkflow` 等

- [ ] **Step 5: `workflowInclude` 与删除/回滚**

去掉 `tasks`/`plan` include；`deleteWorkflowRun` / `applyRollbackDataCleanup` 不再删 task/plan。

- [ ] **Step 6: Controller**

删除 demo / task-split / plan 路由与 `GET artifacts/plan`（若仍要 HTML 产物，改为 `GET :id/artifacts/spec-plan` 且仅服务 SpecPlan 渲染；MVP 可 Web 直接渲染 JSON/markdown，artifact 可删或后置）。

新增：

```typescript
@Post(':id/spec-plan/run')
runSpecPlan(@Param('id') id: string, @Req() req: WorkflowRequest) {
  return this.workflowService.runSpecPlan(id, undefined, req.authSession);
}

@Post(':id/spec-plan/revise')
reviseSpecPlan(@Param('id') id: string, @Body() dto: StageFeedbackDto, @Req() req: WorkflowRequest) {
  return this.workflowService.runSpecPlan(id, dto.feedback, req.authSession);
}

@Post(':id/spec-plan/confirm')
confirmSpecPlan(@Param('id') id: string) {
  return this.workflowService.confirmSpecPlan(id);
}

@Post(':id/spec-plan/reject')
rejectSpecPlan(@Param('id') id: string, @Body() dto: StageFeedbackDto) {
  return this.workflowService.rejectSpecPlan(id, dto.feedback);
}

@Post(':id/spec-plan/manual-edit')
manualEditSpecPlan(@Param('id') id: string, @Body() dto: /* SpecPlanOutput body */) {
  return this.workflowService.manualEditSpecPlan(id, dto);
}
```

- [ ] **Step 7: 跑 workflow 测试并修到可编译绿（本 task 范围）**

```bash
pnpm --filter flowx-api exec vitest run src/workflow/workflow.service.spec.ts src/common/workflow-state-machine.spec.ts
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/workflow
git commit -m "feat(api): wire SPEC_PLAN stage and remove demo/task-split/plan APIs"
```

---

### Task 5: 执行 / handoff / bootstrap 改吃 SpecPlan

**Files:**
- Modify: `apps/api/src/workflow/workflow.service.ts`（`runExecution` 等）
- Modify: `apps/api/src/workflow/workflow-local-handoff.ts`
- Modify: `apps/api/src/workflow/bug-fix-workflow.bootstrap.ts`
- Modify: `apps/api/src/workflow/bug-fix-workflow.bootstrap.spec.ts`
- Modify: `apps/api/src/workflow/workflow-local-chat-bootstrap.spec.ts`
- Modify: related `workflow-local-*.spec.ts`、`edge-*.spec.ts`

- [ ] **Step 1: `resolveConfirmedSpecPlan`**

从最新已确认的 `SPEC_PLAN` `StageExecution.output` 解析 `SpecPlanOutput`；缺失则抛明确错误。

- [ ] **Step 2: `runExecution` / review**

构造 `ExecuteTaskInput` / `ReviewCodeInput` 时传 `specPlan`，删除对 `workflow.tasks` / `workflow.plan` 的依赖。

- [ ] **Step 3: Local handoff payload**

```typescript
export type LocalHandoffPayload = {
  // ...existing fields...
  specPlan: SpecPlanOutput;
};
```

删除 `tasks` 数组与旧 `plan` 表形状字段。更新所有序列化/测试。

- [ ] **Step 4: BUG_FIX bootstrap**

```typescript
export const BUG_FIX_SKIPPED_STAGES: StageType[] = [
  StageType.BRAINSTORM,
  StageType.DESIGN,
  StageType.SPEC_PLAN,
];

export function buildBugFixSpecPlan(bug: BugFixPayload): SpecPlanOutput {
  return {
    spec: {
      goal: `修复缺陷：${bug.title}`,
      scope: [bug.description ?? bug.title],
      nonGoals: ['无关重构'],
      acceptanceCriteria: ['缺陷复现路径关闭', '回归相关用例'],
      constraints: [],
    },
    plan: {
      approach: '最小改动修复根因并补充验证',
      touchpoints: [],
      sequence: ['定位', '修复', '验证'],
      risks: [],
      verification: ['按复现步骤确认已修复'],
    },
  };
}
```

`applyBugFixBootstrap` / local-chat bootstrap：写 `SPEC_PLAN` stage COMPLETED + `SPEC_PLAN_CONFIRMED`（或直接进入执行所需状态），**不再** `tx.task.create` / `tx.plan.create`。删除 `buildBugFixTask` / `buildBugFixPlanContent`。

- [ ] **Step 5: 跑相关测试**

```bash
pnpm --filter flowx-api exec vitest run src/workflow/bug-fix-workflow.bootstrap.spec.ts src/workflow/workflow-local-handoff.spec.ts src/workflow/workflow-local-chat-bootstrap.spec.ts src/workflow/workflow-local-execution.spec.ts src/edge/
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow apps/api/src/edge
git commit -m "feat(api): execution and bootstrap consume SpecPlan output only"
```

---

### Task 6: 硬删需求侧 ideation Demo

**Files:**
- Modify: `apps/api/src/requirements/requirements.controller.ts`
- Modify: `apps/api/src/requirements/requirements.service.ts`
- Modify: `apps/api/src/requirements/ideation-recovery.service.ts`
- Delete or gut: `apps/api/src/requirements/requirements-demo.spec.ts`
- Modify: ideation recovery specs
- Optionally delete unused: `apps/api/src/common/demo-router-integration.ts`（若仅 Demo 使用且无设计阶段引用）

- [ ] **Step 1: 删除 controller 三个 demo 路由**

- [ ] **Step 2: 删除 service 中 `startDemoGeneration` / `reviseDemoGeneration` / `confirmDemoGeneration`**

`finalizeIdeation`：在 `DESIGN_CONFIRMED`（或设计完成等价状态）即可 finalize，不再要求 `DEMO_CONFIRMED`。

- [ ] **Step 3: recovery 去掉 DEMO 状态与 `DEMO_PAGE` 恢复路径**

- [ ] **Step 4: 跑 requirements 测试**

```bash
pnpm --filter flowx-api exec vitest run src/requirements/
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/requirements apps/api/src/common
git commit -m "feat(api): remove requirements ideation demo endpoints"
```

---

### Task 7: Web 硬切

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/utils/workflow-ui.ts`
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`
- Modify: `apps/web/src/components/StageCard.tsx`
- Modify: `apps/web/src/components/IdeationDesignPanel.tsx` / `IdeationBrainstormPanel.tsx`
- Delete/update: `apps/web/src/types-demo.test.ts`、`IdeationDesignPanel.test.tsx`

- [ ] **Step 1: `api.ts`**

删除 `runDemo`/`reviseDemo`/`confirmDemo`/`skipDemo`、requirements demo 三方法、全部 task-split/plan 方法与 `fetchPlanArtifact`。

新增：

```typescript
runSpecPlan: (id: string) =>
  request<WorkflowRun>(`/workflow-runs/${id}/spec-plan/run`, { method: 'POST' }),
reviseSpecPlan: (id: string, feedback: string) =>
  request<WorkflowRun>(`/workflow-runs/${id}/spec-plan/revise`, {
    method: 'POST',
    body: JSON.stringify({ feedback }),
  }),
confirmSpecPlan: (id: string) =>
  request<WorkflowRun>(`/workflow-runs/${id}/spec-plan/confirm`, { method: 'POST' }),
rejectSpecPlan: (id: string, feedback: string) =>
  request<WorkflowRun>(`/workflow-runs/${id}/spec-plan/reject`, {
    method: 'POST',
    body: JSON.stringify({ feedback }),
  }),
manualEditSpecPlan: (id: string, body: SpecPlanOutput) =>
  request<WorkflowRun>(`/workflow-runs/${id}/spec-plan/manual-edit`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
```

- [ ] **Step 2: `types.ts` / `workflow-ui.ts`**

删除 `WorkflowRun.tasks` / `WorkflowRun.plan`；状态文案改为 Spec & Plan；删除 DEMO/TASK_SPLIT/PLAN 中文标签。

- [ ] **Step 3: `WorkflowRunDetailPage.tsx`**

```typescript
const STAGE_SEQUENCE = [
  'REPOSITORY_GROUNDING',
  'BRAINSTORM',
  'DESIGN',
  'SPEC_PLAN',
  'EXECUTION',
  'AI_REVIEW',
  'HUMAN_REVIEW',
] as const;
```

- 删除 Demo 预览 dialog、demoPages 解析、计划 iframe（或改为 Spec&Plan 文档面板）
- 选中 `SPEC_PLAN` 时展示 `output.spec` / `output.plan` / `output.notes`（可读 markdown/结构化卡片）
- 操作：生成 / 修订 / 人工编辑 / 确认 / 驳回
- `resolveSelectedStageFromStatus`：映射 `SPEC_PLAN_*`

- [ ] **Step 4: Ideation 面板**

去掉 Demo 生成按钮与 `DEMO_*` 门闩；设计确认即可视为 ideation 完成。

- [ ] **Step 5: 更新/重写 `WorkflowRunDetailPage.test.tsx` 等**

覆盖：设计后进入 SPEC_PLAN；确认后可执行；无 demo/task-split API mock。

- [ ] **Step 6: 跑 web 测试**

```bash
pnpm --filter flowx-web test
```

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): Spec & Plan stage UI; remove demo and task/plan surfaces"
```

---

### Task 8: Cursor Extension 硬切

**Files:**
- Modify: `apps/cursor-extension/src/flowx-client.ts`
- Modify: `apps/cursor-extension/src/run-detail-model.ts`
- Modify: `apps/cursor-extension/src/run-detail-actions.ts`
- Modify: 对应 `*.test.ts`、`handoff.test.ts`、`local-execution.test.ts` 等

- [ ] **Step 1: HTTP 客户端只调 `/spec-plan/*`**

- [ ] **Step 2: 阶段模型用 `SPEC_PLAN`；删除 DEMO/TASK_SPLIT/TECHNICAL_PLAN**

- [ ] **Step 3: handoff 解析 `specPlan`**

- [ ] **Step 4: 跑 extension 测试**

```bash
pnpm --filter cursor-extension test
```

（若 package 名不同，以 `apps/cursor-extension/package.json` 的 name 为准。）

- [ ] **Step 5: Commit**

```bash
git add apps/cursor-extension
git commit -m "feat(extension): use SPEC_PLAN actions and handoff payload"
```

---

### Task 9: 文档与全量验收

**Files:**
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`（与源一致）
- Modify: `README.md`
- Modify: `docs/system-design.md`
- Modify: `docs/workflow-artifacts.md`（若仍描述 TECHNICAL_PLAN plan.html）
- Modify: `CLAUDE.md`（AIExecutor 方法名）

- [ ] **Step 1: 用户手册**

阶段列表改为：

`仓库准备 → 产品构思 → 设计方案 → Spec & Plan → 执行开发 → AI 审查 → 人工确认`

删除 Demo / 任务拆解表 / 独立技术方案闸门描述；状态文案同步。

- [ ] **Step 2: 同步镜像**

```bash
cp docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/user-manual.md apps/web/public/user-manual.md
```

- [ ] **Step 3: README / system-design**

数据模型链改为 `StageExecution(SpecPlan) / CodeExecution / Review…`，去掉 Task/Plan。

- [ ] **Step 4: 全量 API + Web 测试**

```bash
pnpm --filter flowx-api test
pnpm --filter flowx-web test
pnpm --filter flowx-api build
pnpm --filter flowx-web build
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs README.md CLAUDE.md apps/web/public/user-manual.md
git commit -m "docs: align manuals with Spec & Plan workflow"
```

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| 删 Demo 阶段 | 1, 4, 6, 7 |
| DESIGN → SPEC_PLAN | 1, 4 |
| 一次 Spec&Plan 闸门、不可 skip | 1, 4 |
| 文档产物 shape | 2, 4 |
| 云端 generateSpecPlan MVP | 2, 4 |
| 硬删 API 无别名 | 4, 6, 7, 8 |
| 删 Task/Plan | 3, 5 |
| 存量 status 迁移 | 3 |
| PLAN_CONFIRMED → SPEC_PLAN_CONFIRMED 不自动执行 | 3 |
| 执行读 SpecPlan | 5 |
| BUG_FIX / local bootstrap | 5 |
| 需求 ideation demo 硬删 | 6 |
| Web / 手册 | 7, 9 |
| 本地 Spec&Plan handoff / 多人 | Non-goal（不做） |

## 执行提示

- 高风险文件保持窄提交；每 Task 结束必须测试绿再进下一 Task。
- `WorkflowRunDetailPage.tsx` 体量大：先改 `STAGE_SEQUENCE` 与 API 调用，再删死代码，避免一次大重构。
- 本地 DB：`db push` 会丢 Task/Plan 表；开发环境可接受。
