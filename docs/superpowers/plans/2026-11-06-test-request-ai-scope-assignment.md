# 提测 AI 范围与人员分派 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将提测改造成“AI 自动生成默认范围草稿 → 人工删改 → 按模块分派 → 创建执行轮次”的单一主流程，并保留历史快照与本地 Agent 兼容边界。

**Architecture:** 在现有 `TestRequest`/`TestPlan`/`TestCaseSnapshot` 之上增加提测范围草稿与快照分派数据；AI 生成复用现有测试设计输入和 AI executor，但由提测创建触发。Web 在提测详情中提供范围草稿工作台和分派工作台；MCP 扩展 `flowx_test_requests` 与测试 Skill，所有权限、状态和快照规则继续由 API 服务端统一校验。

**Tech Stack:** NestJS、Prisma、SQLite、TypeScript、React、Vite、Vitest、FlowX MCP、`@flowx-ai/protocol`。

---

## 文件与职责映射

- `prisma/schema.prisma`：提测范围草稿、快照模块信息和最终分派字段。
- `prisma/migrations/20261106180000_test_request_scope_assignment/migration.sql`：SQLite 迁移。
- `apps/api/src/quality/dto/test-request.dto.ts`：范围草稿编辑、批量删除、确认和分派 DTO。
- `apps/api/src/quality/test-request-scope.service.ts`：AI 草稿生成、草稿修改和确认快照业务边界。
- `apps/api/src/quality/test-request-assignment.service.ts`：确认快照后的模块默认负责人和单条用例分派。
- `apps/api/src/quality/test-request-scope.service.spec.ts`：范围草稿、快照和分派单元测试。
- `apps/api/src/quality/test-requests.controller.ts`、`apps/api/src/quality/quality.module.ts`：HTTP 路由和服务注入。
- `apps/api/src/quality/test-requests.service.ts`、`apps/api/src/quality/test-runs.service.ts`：提测创建触发分析、旧提测兼容和执行轮次读取已分派快照。
- `apps/web/src/types.ts`、`apps/web/src/api.ts`：严格的范围草稿、快照分派和 API 类型。
- `apps/web/src/pages/quality/QualityScopeDraftPanel.tsx`：库/模块/用例批量删改和整体确认。
- `apps/web/src/pages/quality/QualityAssignmentPanel.tsx`：模块默认负责人、多人拆分和单条改派。
- `apps/web/src/pages/quality/QualityRequestDetailPage.tsx`：提测详情状态、页签和主操作收敛。
- `apps/web/src/pages/quality/QualityScopeDraftPanel.test.tsx`、`QualityAssignmentPanel.test.tsx`、`QualityPages.test.tsx`：关键交互回归。
- `packages/flowx-local/src/mcp.ts`、`packages/flowx-local/src/mcp.test.ts`：本地工具 schema、请求映射、返回和错误验证。
- `packages/flowx-local/templates/flowx-local-test/SKILL.md`、`flowx-continue/SKILL.md`、`flowx-intake-requirement/SKILL.md`：新提测顺序和整体确认语义。
- `docs/local-agent-guide.md`、`apps/web/public/local-agent-guide.md`、`docs/user-manual.md`、`apps/web/public/user-manual.md`：用户和本地 Agent 文档。
- `CHANGELOG.md`：每个实现提交同步用户可见变化。

### Task 1: 扩展质量域数据模型并建立迁移

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261106180000_test_request_scope_assignment/migration.sql`
- Test: `apps/api/src/quality/quality-migration.spec.ts`

- [ ] **Step 1: 写迁移回归测试**

在 `quality-migration.spec.ts` 的现有旧数据插入场景中增加断言：旧 `TestRequest` 能读取空范围草稿和空分派；旧 `TestCaseSnapshot` 的新增可选字段为 `null`；已有 `TestRunCase.assignedToUserId` 行为不变。

- [ ] **Step 2: 运行迁移测试确认失败**

运行：

```bash
pnpm --filter flowx-api exec vitest run src/quality/quality-migration.spec.ts
```

预期：新增字段尚不存在时 TypeScript/Prisma 查询失败。

- [ ] **Step 3: 增加 Prisma 模型**

新增 `TestRequestScopeCase`，字段包括 `testRequestId`、可空 `sourceDefinitionId`、`sourceVersion`、可空 `libraryId`/`moduleId`/`moduleName`、`action`、`title`、`priority`、`precondition`、`testData`、`targetKeys`、`steps`、`expected`、`metadata`、`coverageKeys`、`matchReason`、`origin`、`status`、`sortOrder`、`createdAt`、`updatedAt`。`status` 默认 `INCLUDED`，删除草稿只改为 `REMOVED`，不物理删除分析证据。

在 `TestCaseSnapshot` 增加可空 `libraryId`、`moduleId`、`moduleName`、`assignedToUserId`、`assignedByUserId`、`assignedAt`，并增加对应 `User` 关系和索引。保持 `TestRunCase.assignedToUserId` 不变，轮次仍可在执行层覆盖负责人。

- [ ] **Step 4: 生成 Prisma Client 和迁移 SQL**

运行：

```bash
pnpm prisma:generate
pnpm --filter flowx-api exec prisma migrate dev --schema ../../prisma/schema.prisma --name test_request_scope_assignment
```

将生成的 SQL 保存为新迁移，检查 SQLite 外键、索引和旧数据默认值；不要提交生成的 Prisma Client。

- [ ] **Step 5: 运行迁移回归并提交**

运行：

```bash
pnpm --filter flowx-api exec vitest run src/quality/quality-migration.spec.ts
```

预期：迁移和旧数据兼容测试通过。提交：`扩展提测范围与分派数据模型`，同时在 `CHANGELOG.md` 的未发布条目记录数据契约维护。

### Task 2: 建立提测范围草稿服务和 AI 自动生成入口

**Files:**
- Create: `apps/api/src/quality/test-request-scope.service.ts`
- Create: `apps/api/src/quality/test-request-scope.service.spec.ts`
- Modify: `apps/api/src/quality/test-requests.service.ts`
- Modify: `apps/api/src/quality/test-requests.controller.ts`
- Modify: `apps/api/src/quality/quality.module.ts`
- Modify: `apps/api/src/quality/dto/test-request.dto.ts`

- [ ] **Step 1: 写范围服务失败测试**

覆盖以下行为：创建草稿后触发一次分析；`REUSE`、`OPTIMIZE`、`CREATE` 生成 `INCLUDED` 草稿；`EXCLUDE` 只保留分析记录且不进入范围；重复触发不生成第二个运行中的任务；AI 失败写入 `FAILED` 和安全错误信息并保留上一版草稿。

测试应使用假的 AI executor 和 Prisma transaction mock，断言输入包含需求、确认的设计、工作流提交上下文和项目/共享用例库边界。

- [ ] **Step 2: 运行失败测试**

运行：

```bash
pnpm --filter flowx-api exec vitest run src/quality/test-request-scope.service.spec.ts
```

预期：服务和 DTO 尚不存在，测试失败。

- [ ] **Step 3: 实现 `TestRequestScopeService.startAnalysis`**

从提测关联的需求、工作流和代码交付记录组装上下文，调用现有测试设计 AI 生成/解析能力；使用 `scopeGenerationStatus` 表示 `NOT_STARTED`、`RUNNING`、`COMPLETED`、`FAILED`，用 `scopeRevision` 做幂等和并发版本。将候选写入 `TestRequestScopeCase`，不创建 `TestCaseDefinition`。

- [ ] **Step 4: 修改创建提测流程**

放宽 `CreateTestRequestDto.testDesignId` 的必填限制；创建提测时保留旧客户端传入已确认 `testDesignId` 的兼容路径，同时为新流程创建 `TestPlan` 和范围草稿，并在事务提交后触发后台分析。创建接口只返回草稿状态，不自动进入 `READY` 或开始测试。

- [ ] **Step 5: 注册查询和重试接口**

增加 `GET /quality/test-requests/:id/scope-draft` 和 `POST /quality/test-requests/:id/scope-draft/analyze`。查询返回分页元数据、库/模块计数、候选来源和分析错误；重试校验提测仍为 `DRAFT`，对已确认版本创建新的草稿修订。

- [ ] **Step 6: 运行范围服务测试并提交**

运行同一组 Vitest 命令，预期全部通过。提交：`新增提测 AI 范围草稿服务`，在 `CHANGELOG.md` 记录提测创建后的自动分析行为。

### Task 3: 实现范围草稿删改、补充和确认快照

**Files:**
- Modify: `apps/api/src/quality/dto/test-request.dto.ts`
- Modify: `apps/api/src/quality/test-request-scope.service.ts`
- Modify: `apps/api/src/quality/test-requests.controller.ts`
- Modify: `apps/api/src/quality/test-request-scope.service.spec.ts`
- Modify: `apps/api/src/quality/test-requests.service.ts`

- [ ] **Step 1: 写删改和确认失败测试**

覆盖库级/模块级/批量/单条移除、补充已有正式用例、编辑 `CREATE` 内容、`scopeRevision` 冲突、空范围拒绝，以及确认事务只把 `INCLUDED` 候选转换成快照。断言新候选不创建正式库定义，已有库定义版本不被更新。

- [ ] **Step 2: 增加 DTO 和路由**

增加严格 DTO：

```ts
class UpdateScopeDraftDto {
  scopeRevision!: number;
  removedCaseIds!: string[];
  addedDefinitionIds!: string[];
  edits?: Array<{ caseId: string; title: string; priority: string; precondition?: string | null; steps: string[]; expected: string; testData?: string | null; moduleId?: string | null }>;
}
class ConfirmScopeDto { scopeRevision!: number; summary?: string; }
```

注册 `PATCH /:id/scope-draft`、`GET /:id/scope-draft/cases`、`POST /:id/scope/confirm`，所有写入使用 `scopeRevision` CAS。

- [ ] **Step 3: 实现批量删改和补充**

删除只把草稿标记为 `REMOVED`；补充时验证用例属于当前 Workspace 的共享库或项目库，复制当前定义版本进入草稿；编辑只允许修改本次草稿字段。保存失败不改变 revision。

- [ ] **Step 4: 实现确认快照事务**

确认时校验提测状态、关联工作流完成状态和至少一个 `INCLUDED` 功能用例；在同一事务创建或替换当前 `TestPlan` 的功能快照，复制模块信息和来源字段，写入 `scopeRevision`、确认摘要与审计用户。已确认版本重复提交必须幂等，过期 revision 返回 409。

- [ ] **Step 5: 运行后端质量测试并提交**

运行：

```bash
pnpm --filter flowx-api exec vitest run src/quality/test-request-scope.service.spec.ts src/quality/test-requests.prepare.spec.ts src/quality/test-requests.service.spec.ts
```

提交：`支持提测范围批量删改与整体确认`，同步变更记录。

### Task 4: 实现快照分派和执行轮次门禁

**Files:**
- Create: `apps/api/src/quality/test-request-assignment.service.ts`
- Create: `apps/api/src/quality/test-request-assignment.service.spec.ts`
- Modify: `apps/api/src/quality/test-requests.controller.ts`
- Modify: `apps/api/src/quality/test-runs.service.ts`
- Modify: `apps/api/src/quality/dto/test-run.dto.ts`

- [ ] **Step 1: 写分派失败测试**

覆盖模块默认负责人、模块内多人拆分、单条覆盖、清除负责人、非活动成员、跨组织成员、未确认范围和未分派用例的拒绝路径；同一 revision 重试必须幂等。

- [ ] **Step 2: 增加分派 DTO 和接口**

定义：

```ts
class AssignScopeCasesDto {
  scopeRevision!: number;
  moduleAssignments?: Array<{ moduleId: string | null; userId: string }>;
  caseAssignments?: Array<{ snapshotId: string; userId: string | null }>;
}
```

注册 `GET /:id/assignments`、`PATCH /:id/assignments` 和 `POST /:id/assignments/complete`，返回模块汇总、人员汇总、未分派数和分页明细。

- [ ] **Step 3: 实现模块默认与单条覆盖**

将模块默认值应用到没有单条覆盖的快照；单条分派只更新指定快照；所有成员必须属于当前组织且为 `ACTIVE`。完成分派前不允许创建正式轮次。

- [ ] **Step 4: 修改创建轮次门禁**

`TestRunsService` 创建功能/回归轮次时默认读取提测已确认且已分派的快照；保留旧客户端显式 `cases` 参数兼容，但拒绝绕过未分派门禁。测试轮次生成的 `TestRunCase.assignedToUserId` 从快照负责人复制。

- [ ] **Step 5: 运行测试并提交**

运行：

```bash
pnpm --filter flowx-api exec vitest run src/quality/test-request-assignment.service.spec.ts src/quality/test-runs.service.spec.ts
```

提交：`增加提测快照人员分派与执行门禁`，同步 `CHANGELOG.md`。

### Task 5: 更新 Web API 类型并实现范围工作台

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/api.ts`
- Create: `apps/web/src/pages/quality/QualityScopeDraftPanel.tsx`
- Create: `apps/web/src/pages/quality/QualityScopeDraftPanel.test.tsx`
- Modify: `apps/web/src/pages/quality/QualityRequestDetailPage.tsx`

- [ ] **Step 1: 写 Web 失败测试**

在 `QualityScopeDraftPanel.test.tsx` 覆盖分析中、默认纳入、库/模块/批量/单条删除、搜索分页、补充已有用例、编辑新用例、失败重试、revision 冲突和点击整体确认。测试断言不存在逐条“接受/排除/确认”按钮。

- [ ] **Step 2: 增加严格类型和 API helper**

在 `types.ts` 增加 `TestRequestScopeCase`、`TestRequestScopeDraft`、`TestRequestAssignmentSummary`；在 `api.ts` 增加 `getTestRequestScopeDraft`、`retryTestRequestScopeAnalysis`、`updateTestRequestScopeDraft`、`confirmTestRequestScope`。所有分页参数复用 `ListQuery`，不在页面使用裸 `fetch`。

- [ ] **Step 3: 实现三栏范围工作台**

左侧加载库/模块树，中间按模块分组展示默认纳入候选，右侧展示范围摘要。批量操作提交显式 ID 集合；后台刷新保留已有草稿和当前编辑；错误区分分析失败、权限错误和网络错误。

- [ ] **Step 4: 接入提测详情状态和主操作**

将 `QualityRequestDetailPage` 的“准备测试范围/冻结范围”文案收敛为“AI 分析/确认范围”，新增范围草稿页签；只有范围确认成功后才显示分派区，确认成功后刷新快照并切换到待分派状态。保留原有执行、缺陷、报告页签。

- [ ] **Step 5: 运行 Web 测试并提交**

运行：

```bash
pnpm --filter flowx-web exec vitest run src/pages/quality/QualityScopeDraftPanel.test.tsx src/pages/quality/QualityPages.test.tsx
```

提交：`实现提测 AI 范围工作台`，更新 `CHANGELOG.md`。

### Task 6: 实现 Web 分派工作台并收敛创建轮次

**Files:**
- Create: `apps/web/src/pages/quality/QualityAssignmentPanel.tsx`
- Create: `apps/web/src/pages/quality/QualityAssignmentPanel.test.tsx`
- Modify: `apps/web/src/pages/quality/QualityRequestDetailPage.tsx`
- Modify: `apps/web/src/pages/quality/QualityCreateRunDialog.tsx`
- Modify: `apps/web/src/pages/quality/QualityExecution.test.tsx`

- [ ] **Step 1: 写分派交互失败测试**

覆盖模块负责人继承、多人拆分、单条改派、未分派筛选、按人员汇总、成员搜索分页、保存失败保留编辑和完成分派门禁。

- [ ] **Step 2: 增加 API helper 与组件状态**

增加 `getTestRequestAssignments`、`updateTestRequestAssignments`、`completeTestRequestAssignments`，组件维护模块默认映射和单条覆盖映射，提交时只发送显式变化。

- [ ] **Step 3: 实现模块分派表**

每行显示模块、用例数、负责人和进度；模块选择成员后批量继承；展开后多选用例改派；未分派计数固定显示。完成分派按钮在未分派数大于 0 时禁用。

- [ ] **Step 4: 调整创建轮次对话框**

默认展示已分派快照，移除重复的“重新选同一批用例”路径；保留目标端和执行模式选择。创建请求的 `cases` 从已分派快照生成，UI 不允许提交未分派快照。

- [ ] **Step 5: 运行 Web 质量测试并提交**

运行：

```bash
pnpm --filter flowx-web exec vitest run src/pages/quality/QualityAssignmentPanel.test.tsx src/pages/quality/QualityExecution.test.tsx src/pages/quality/QualityPages.test.tsx
```

提交：`实现提测用例人员分派工作台`，同步变更记录。

### Task 7: 支持 AI 新用例人工沉淀和 MCP/Skill 适配

**Files:**
- Modify: `apps/api/src/quality/test-request-scope.service.ts`
- Modify: `apps/api/src/quality/case-libraries.service.ts`
- Modify: `packages/flowx-local/src/mcp.ts`
- Modify: `packages/flowx-local/src/mcp.test.ts`
- Modify: `packages/flowx-local/templates/flowx-local-test/SKILL.md`
- Modify: `packages/flowx-local/templates/flowx-continue/SKILL.md`
- Modify: `packages/flowx-local/templates/flowx-intake-requirement/SKILL.md`

- [ ] **Step 1: 写 MCP/API 失败测试**

覆盖提测创建后自动分析、读取范围草稿、批量删除、整体确认、读取分派和完成分派的工具 schema；`CREATE` 快照主动保存到项目库时透传完整字段，未主动保存不产生正式用例；旧 `flowx_test_requests` 的 `create/get/prepare` 请求仍可解析。

- [ ] **Step 2: 增加保存新用例接口**

增加 `POST /quality/test-requests/:id/scope-draft/:caseId/save-to-library`，复用正式用例创建服务和编号事务；校验快照来源为 `CREATE`、提测权限和目标项目库，成功后返回新 `TestCaseDefinition` 和来源快照 ID。

- [ ] **Step 3: 扩展 `flowx_test_requests`**

新增 `scope-draft`、`retry-analysis`、`confirm-scope`、`assign`、`complete-assignment` 动作或等价 `collection`，请求映射使用 API 的 revision 和显式 ID；工具描述明确“默认纳入、人工删改、整体确认”，禁止 Agent 自行把候选逐项设为人工确认结果。

- [ ] **Step 4: 更新本地 Skill**

将旧流程“逐候选处理 → 确认测试设计 → prepare”改为“创建/读取提测 → 等待 AI 草稿 → 展示并按用户意见删改 → 用户整体确认范围 → 分派 → 创建轮次”。保留旧客户端能力说明和不支持时的明确升级错误。

- [ ] **Step 5: 运行本地包测试和构建并提交**

运行：

```bash
pnpm --filter @flowx-ai/protocol build
pnpm --filter @flowx-ai/local test
pnpm --filter @flowx-ai/local build
```

提交：`适配提测范围与分派本地工具`，记录旧客户端兼容行为。

### Task 8: 同步用户文档并完成全链路验证

**Files:**
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`
- Modify: `docs/local-agent-guide.md`
- Modify: `apps/web/public/local-agent-guide.md`
- Modify: `README.md`（仅在提测入口或命令说明变化时）
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 更新用户手册**

把“测试设计逐条确认/冻结范围/执行轮次再次选例”改为 AI 自动生成草稿、人工删改、整体确认和模块分派；明确 AI 新用例默认只属于本次提测，保存到用例库必须人工触发。

- [ ] **Step 2: 更新本地 Agent 指南**

同步 MCP 工具动作、调用顺序、分页约定、权限和旧版本升级提示。保持源文件和 Web 镜像逐字一致。

- [ ] **Step 3: 执行专项验证**

运行：

```bash
pnpm prisma:generate
pnpm --filter @flowx-ai/protocol build
pnpm --filter flowx-api build
pnpm --filter flowx-web build
pnpm --filter flowx-api test -- --runInBand
pnpm --filter flowx-web test -- --runInBand
pnpm --filter @flowx-ai/local test
pnpm --filter @flowx-ai/local build
pnpm check
git diff --check
cmp -s docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
```

API 全量测试中的外部 Git 集成测试若因环境超时，记录具体失败套件；质量域专项测试必须全部通过。

- [ ] **Step 4: 检查变更范围并提交**

确认没有 `dist/`、Prisma 生成物、`.flowx-data` 或凭据进入 Git；确认每个用户可见变化都在手册和 `CHANGELOG.md` 中；提交：`完成提测 AI 范围与人员分派闭环`。

## 自检记录

- 规范覆盖：数据模型、AI 自动分析、默认纳入与删改、确认快照、模块分派、执行门禁、新用例人工沉淀、MCP/Skill 兼容、Web 错误状态和文档同步均有任务对应。
- 自检扫描：计划中的每一步均给出具体文件、命令和预期结果；迁移文件名和生成命令已固定，内容由 Task 1 的 Prisma migration 具体产生。
- 类型一致性：范围统一使用 `scopeRevision`，快照负责人统一使用 `assignedToUserId`，草稿状态统一使用 `INCLUDED`/`REMOVED`，与各任务 DTO 和测试名称一致。
- 已知基线：Web 基线 59 个测试文件、413 项通过；API 首次全量因工作树缺少协议构建物和 Prisma Client 收集失败，补齐后质量域 4 个核心套件共 52 项通过；全量中另有 Git 集成钩子超时，执行 Task 8 时重新核对。
