# 手动缺陷登记与缺陷修复工作流 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持 QA 手动创建缺陷，研发从缺陷一键发起仅含「执行 + 审查」的 BUG_FIX 工作流。

**Architecture:** 扩展 Prisma（`runType`、`fixWorkflowRunId`）；在 `review-artifacts` 增加 `POST /bugs`；在 `workflow` 增加 bootstrap + `POST /bugs/:id/fix-workflow`；前端缺陷列表/详情增加创建与发起修复 UI。

**Tech Stack:** NestJS, Prisma/SQLite, Vitest, React 19, Vite, 现有 WorkflowStateMachine + AIExecutor。

**Spec:** `docs/superpowers/specs/2026-05-18-manual-bug-fix-workflow-design.md`

---

## File map

| 文件 | 职责 |
|------|------|
| `prisma/schema.prisma` | `WorkflowRun.runType`, `WorkflowRun.bugId`, `Bug.fixWorkflowRunId`, `Bug.projectId` |
| `apps/api/src/common/enums.ts` | `WorkflowRunType` enum |
| `apps/api/src/common/workflow-state-machine.ts` | BUG_FIX bootstrap 转换规则 |
| `apps/api/src/workflow/bug-fix-workflow.bootstrap.ts` | **新建** — 合成 task/plan、SKIPPED 阶段 |
| `apps/api/src/workflow/workflow.service.ts` | `createBugFixWorkflowRun`, `runExecution` bug_fix 分支 |
| `apps/api/src/workflow/workflow.controller.ts` | 路由（或 bugs 子路由） |
| `apps/api/src/review-artifacts/dto/create-bug.dto.ts` | **新建** |
| `apps/api/src/review-artifacts/dto/start-bug-fix-workflow.dto.ts` | **新建** |
| `apps/api/src/review-artifacts/review-artifacts.service.ts` | `createBug`, `startBugFixWorkflow` |
| `apps/api/src/review-artifacts/review-artifacts.controller.ts` | POST 端点 |
| `apps/api/src/review-artifacts/review-artifacts.service.spec.ts` | **新建或扩展** |
| `apps/api/src/workflow/workflow.service.spec.ts` | bootstrap 测试 |
| `apps/web/src/api.ts` | 客户端方法 |
| `apps/web/src/types.ts` | 类型扩展 |
| `apps/web/src/pages/BugsPage.tsx` | 新建缺陷 UI |
| `apps/web/src/pages/BugDetailPage.tsx` | 发起修复 UI |
| `apps/web/src/pages/WorkflowRunDetailPage.tsx` | BUG_FIX badge + 缺陷链接 |
| `apps/web/src/utils/workflow-ui.ts` | runType 标签 |

---

### Task 1: Prisma schema 与枚举

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `apps/api/src/common/enums.ts`

- [ ] **Step 1: 写失败测试（枚举/映射）**

在 `apps/api/src/common/workflow-state-machine.spec.ts` 末尾添加：

```typescript
it('allows BUG_FIX bootstrap transition to EXECUTION_PENDING when run type is bug_fix', () => {
  expect(machine.canBootstrapBugFixWorkflow(WorkflowRunType.BUG_FIX)).toBe(true);
  expect(machine.canBootstrapBugFixWorkflow(WorkflowRunType.FULL)).toBe(false);
});
```

（先 red — `canBootstrapBugFixWorkflow` 尚不存在）

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter flowx-api exec vitest run apps/api/src/common/workflow-state-machine.spec.ts -t "BUG_FIX bootstrap"
```

Expected: FAIL — method not defined

- [ ] **Step 3: 更新 schema**

`WorkflowRun` 增加：

```prisma
runType String @default("FULL")
bugId   String?
bug     Bug?   @relation("BugFixWorkflow", fields: [bugId], references: [id])
```

`Bug` 增加：

```prisma
projectId        String?
project          Project?     @relation(fields: [projectId], references: [id])
fixWorkflowRunId String?      @unique
fixWorkflowRun   WorkflowRun? @relation("BugFixWorkflow", fields: [fixWorkflowRunId], references: [id])
```

`Project` 增加 `bugs Bug[]`。

- [ ] **Step 4: 生成 client**

```bash
pnpm prisma:generate
pnpm --filter flowx-api exec prisma db push --schema ../../prisma/schema.prisma
```

- [ ] **Step 5: 实现枚举 + state machine 方法**

```typescript
export enum WorkflowRunType {
  FULL = 'FULL',
  BUG_FIX = 'BUG_FIX',
}
```

`WorkflowStateMachine.canBootstrapBugFixWorkflow(runType)` 仅对 `BUG_FIX` 返回 true。

- [ ] **Step 6: 运行测试通过**

```bash
pnpm --filter flowx-api exec vitest run apps/api/src/common/workflow-state-machine.spec.ts
```

---

### Task 2: Bug 内容组装与 bootstrap 模块

**Files:**
- Create: `apps/api/src/workflow/bug-fix-workflow.bootstrap.ts`
- Create: `apps/api/src/workflow/bug-fix-workflow.bootstrap.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { buildBugFixRequirementPayload, buildBugFixPlanContent, buildBugFixTask } from './bug-fix-workflow.bootstrap';

const bug = {
  title: '登录 500',
  description: '点击登录报错',
  expectedBehavior: '应进入首页',
  actualBehavior: '500',
  reproductionSteps: ['打开登录页', '输入账号密码', '点击登录'],
};

it('builds requirement acceptance from expected behavior', () => {
  const req = buildBugFixRequirementPayload(bug as any);
  expect(req.acceptanceCriteria).toContain('应进入首页');
});

it('builds single confirmed task from bug', () => {
  const task = buildBugFixTask(bug as any);
  expect(task.title).toBe('登录 500');
  expect(task.description).toContain('打开登录页');
});
```

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter flowx-api exec vitest run apps/api/src/workflow/bug-fix-workflow.bootstrap.spec.ts
```

- [ ] **Step 3: 实现纯函数**

```typescript
export function buildBugFixRequirementPayload(bug: BugPayload) {
  const reproduction = (bug.reproductionSteps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n');
  const description = [
    bug.description,
    reproduction ? `\n\n复现步骤:\n${reproduction}` : '',
    bug.actualBehavior ? `\n\n实际行为: ${bug.actualBehavior}` : '',
  ].join('');
  return {
    title: `[BugFix] ${bug.title}`,
    description,
    acceptanceCriteria: bug.expectedBehavior ?? '修复后缺陷不再复现，相关路径可正常使用。',
  };
}

export function buildBugFixTask(bug: BugPayload) { /* returns { title, description, surface, repositoryNames } */ }
export function buildBugFixPlanContent(bug: BugPayload) { /* returns plan JSON matching existing Plan.content shape */ }
export const BUG_FIX_SKIPPED_STAGES: StageType[] = [ /* BRAINSTORM, DESIGN, DEMO, TASK_SPLIT, TECHNICAL_PLAN */ ];
```

- [ ] **Step 4: 测试通过**

---

### Task 3: `POST /bugs` 手动创建

**Files:**
- Create: `apps/api/src/review-artifacts/dto/create-bug.dto.ts`
- Modify: `apps/api/src/review-artifacts/review-artifacts.service.ts`
- Modify: `apps/api/src/review-artifacts/review-artifacts.controller.ts`
- Create: `apps/api/src/review-artifacts/review-artifacts.bug.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
it('createBug persists OPEN bug in workspace', async () => {
  const bug = await service.createBug({
    workspaceId: 'ws-1',
    title: 't',
    description: 'd',
  }, 'user-1');
  expect(bug.status).toBe('OPEN');
  expect(bug.workspaceId).toBe('ws-1');
});
```

- [ ] **Step 2: 实现 `createBug`**

- 校验 workspace 存在
- 解析 `projectId`（显式或 `ensureDefaultBugFixProject(workspaceId)`）
- `prisma.bug.create({ data: { ..., reportedByUserId: userId } })`

- [ ] **Step 3: Controller**

```typescript
@Post('bugs')
createBug(@Body() dto: CreateBugDto, @Req() request: AuthenticatedRequest) {
  return this.reviewArtifactsService.createBug(dto, request.user?.id ?? null);
}
```

- [ ] **Step 4: 测试通过**

```bash
pnpm --filter flowx-api exec vitest run apps/api/src/review-artifacts/review-artifacts.bug.spec.ts
```

---

### Task 4: `createBugFixWorkflowRun` + `POST /bugs/:id/fix-workflow`

**Files:**
- Modify: `apps/api/src/workflow/workflow.service.ts`
- Create: `apps/api/src/review-artifacts/dto/start-bug-fix-workflow.dto.ts`
- Modify: `apps/api/src/review-artifacts/review-artifacts.service.ts`（编排调用 WorkflowService）
- Modify: `apps/api/src/workflow/workflow.service.spec.ts`

- [ ] **Step 1: 写失败测试 — bootstrap 后 EXECUTION_PENDING**

```typescript
it('createBugFixWorkflowRun seeds plan and lands on EXECUTION_PENDING', async () => {
  // mock prisma + repository sync
  const run = await service.createBugFixWorkflowRun('bug-1', { repositoryIds: ['repo-1'] });
  expect(run.status).toBe('EXECUTION_PENDING');
  expect(run.runType).toBe('BUG_FIX');
  expect(run.plan?.status).toBe('CONFIRMED');
});
```

- [ ] **Step 2: 实现 `createBugFixWorkflowRun`**

伪代码：

```typescript
async createBugFixWorkflowRun(bugId: string, dto: StartBugFixWorkflowDto) {
  const bug = await this.loadBugForFix(bugId);
  const requirement = await this.ensureFixRequirement(bug);
  const workflow = await this.prisma.$transaction(async (tx) => {
    const run = await tx.workflowRun.create({ data: { requirementId: requirement.id, runType: 'BUG_FIX', bugId, aiProvider } });
    await this.attachRepositories(tx, run.id, dto.repositoryIds, requirement);
    await this.bootstrapBugFixStages(tx, run.id, requirement.id, bug);
    await tx.bug.update({ where: { id: bugId }, data: { status: 'FIXING', fixRequirementId: requirement.id, fixWorkflowRunId: run.id } });
    return run;
  });
  await this.repositorySyncService.prepareWorkflowRepositories(workflow.id);
  await this.transitionToExecutionPending(workflow.id);
  if (dto.autoStart !== false) {
    return this.runExecution(workflow.id, this.buildBugFixFeedback(bug), { triggerType: 'bug_fix', findingTitle: bug.title });
  }
  return this.getWorkflowOrThrow(workflow.id);
}
```

- [ ] **Step 3: `getExecutionCompletionTargetStatus` 增加 `bug_fix`**

```typescript
return triggerType === 'review_finding_fix' || triggerType === 'bug_fix'
  ? WorkflowRunStatus.HUMAN_REVIEW_PENDING
  : WorkflowRunStatus.REVIEW_PENDING;
```

- [ ] **Step 4: Controller 路由**

```typescript
@Post('bugs/:id/fix-workflow')
startBugFixWorkflow(@Param('id') id: string, @Body() dto: StartBugFixWorkflowDto) {
  return this.reviewArtifactsService.startBugFixWorkflow(id, dto);
}
```

- [ ] **Step 5: 测试通过**

```bash
pnpm --filter flowx-api test
```

---

### Task 5: 前端 API 与类型

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

- [ ] **Step 1: 扩展类型**

```typescript
export interface Bug {
  // ...
  fixWorkflowRun?: { id: string; status: string } | null;
  fixWorkflowRunId?: string | null;
  projectId?: string | null;
}

export interface WorkflowRun {
  runType?: string;
  bugId?: string | null;
}
```

- [ ] **Step 2: api 方法 + 测试**

```typescript
createBug: (payload: CreateBugPayload) =>
  request<Bug>('/bugs', { method: 'POST', body: JSON.stringify(payload) }),

startBugFixWorkflow: (bugId: string, payload?: StartBugFixWorkflowPayload) =>
  request<{ bug: Bug; workflowRun: WorkflowRun }>(`/bugs/${bugId}/fix-workflow`, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  }),
```

- [ ] **Step 3: 运行 web 测试**

```bash
pnpm --filter flowx-web test
```

---

### Task 6: BugsPage 新建缺陷

**Files:**
- Modify: `apps/web/src/pages/BugsPage.tsx`

- [ ] **Step 1: PageHeader action「新建缺陷」**
- [ ] **Step 2: Dialog 表单（工作区 → 项目级联，标题，描述，severity，priority，复现步骤）**
- [ ] **Step 3: 提交 `api.createBug` + refresh + toast**
- [ ] **Step 4: 更新 EmptyState 文案：支持手动登记**

遵循 `apps/web/docs/design-system.md`：主 CTA 在 PageHeader，不放进 ListToolbar。

---

### Task 7: BugDetailPage 发起修复

**Files:**
- Modify: `apps/web/src/pages/BugDetailPage.tsx`

- [ ] **Step 1: 加载时展示 `fixWorkflowRun` 链接（若有）**
- [ ] **Step 2: `OPEN`/`CONFIRMED` 显示「发起修复工作流」**
- [ ] **Step 3: Dialog — 仓库多选、AI Provider**
- [ ] **Step 4: 调用 `api.startBugFixWorkflow` → `navigate(/workflow-runs/${id})`**

---

### Task 8: WorkflowRunDetailPage BUG_FIX 展示

**Files:**
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`
- Modify: `apps/web/src/utils/workflow-ui.ts`

- [ ] **Step 1: `formatWorkflowRunType('BUG_FIX')` → `缺陷修复`**
- [ ] **Step 2: Header badge + Link to `/bugs/${bugId}`**（`workflowRun.bugId` 或由 API include bug）
- [ ] **Step 3: 可选：SKIPPED 阶段默认折叠**

---

### Task 9: 全量验证

- [ ] **Step 1: API 测试**

```bash
pnpm --filter flowx-api test
```

- [ ] **Step 2: Web 测试 + 构建**

```bash
pnpm --filter flowx-web test
pnpm --filter flowx-web build
```

- [ ] **Step 3: 根目录检查**

```bash
pnpm check
```

---

## Execution handoff

Plan complete. Two execution options:

1. **Subagent-Driven** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute in this session with executing-plans checkpoints

Which approach do you prefer?
