# 提测范围模块批量确认实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将提测范围工作台改为模块批量确认模式：AI 推荐作为默认范围，按模块展示覆盖状态，人工只审阅例外后进入分派。

**Architecture:** API 继续以 `scopeRevision` 和现有候选/范围记录作为唯一写入事实来源，新增模块摘要、例外视图和 `AI_RECOMMENDED` 批量策略；旧客户端不传策略时保持整模块纳入语义。Web 将目录、模块摘要、例外列表和详情抽屉拆成清晰边界，批量写入继续串行化并复用现有确认接口；不修改数据库快照语义和本地 Agent 链路。

**Tech Stack:** NestJS、Prisma、TypeScript、React、Tailwind、Vitest、SQLite integration tests。

---

## 文件边界

- Modify: `apps/api/src/quality/dto/test-request.dto.ts`：增加模块批量策略校验。
- Modify: `apps/api/src/quality/test-request-scope-browse.ts`：增加 `exceptions` 视图和例外字段装饰。
- Create: `apps/api/src/quality/test-request-scope-summary.ts`：集中实现模块后代、模块摘要和例外原因计算。
- Modify: `apps/api/src/quality/test-requests.service.ts`：接入摘要、例外查询和 `AI_RECOMMENDED` 批量恢复。
- Modify: `apps/api/src/quality/case-libraries.controller.ts`、`apps/api/src/quality/case-libraries.service.ts`：模块列表支持 `testRequestId` 并附加范围摘要。
- Modify: `apps/api/src/quality/test-requests.scope.integration.spec.ts`、`apps/api/src/quality/case-libraries.service.spec.ts`：覆盖事务、权限、兼容和摘要契约。
- Modify: `apps/web/src/types.ts`、`apps/web/src/api.ts`：同步摘要、例外原因、查询和策略字段。
- Modify: `apps/web/src/pages/quality/QualityScopeDirectory.tsx`：目录节点展示摘要并透传 `testRequestId`。
- Create: `apps/web/src/pages/quality/QualityScopeModuleOverview.tsx`：模块状态、批量动作和移除确认弹层。
- Modify: `apps/web/src/pages/quality/QualityScopeDraftPanel.tsx`：重组工作台总览、例外视图、批量写入和确认摘要。
- Modify: `apps/web/src/pages/quality/QualityScopeDraftPanel.test.tsx`、`apps/web/src/api.test.ts`：覆盖 Web 交互和请求映射。
- Modify: `docs/quality-foundation.md`、`docs/system-design.md`、`docs/user-manual.md`、`apps/web/public/user-manual.md`、`CHANGELOG.md`：同步契约、使用说明和未发布变更。

## Task 1: 建立 API 共享计算边界和 DTO 策略

**Files:**

- Create: `apps/api/src/quality/test-request-scope-summary.ts`
- Modify: `apps/api/src/quality/dto/test-request.dto.ts`
- Modify: `apps/api/src/quality/test-request-scope-browse.ts`

- [ ] **Step 1: 先写服务层单元/集成断言，锁定策略语义**

在 `apps/api/src/quality/test-requests.scope.integration.spec.ts` 的 fixture 中创建：一个 AI 推荐的库用例、一个 AI 明确排除的库用例、一个 AI 新建候选和一个人工补选候选。先增加以下断言：

```ts
await service.updateScopeModule(request.id, {
  scopeRevision: 2,
  moduleId: module.id,
  included: true,
  strategy: 'AI_RECOMMENDED',
});

expect(await selectedIds(request.id)).toEqual(['ai-reuse-id', 'ai-create-id']);
expect(await selectedIds(request.id)).not.toContain('library-only-id');
```

同时断言旧请求 `{ included: true }` 仍然可以纳入完整模块，`view=exceptions` 返回 `exceptionReason`，模块摘要在 100 条以上用例和子模块场景下仍统计全量。

- [ ] **Step 2: 运行新增 API 测试，确认先失败**

Run: `pnpm --filter flowx-api exec vitest run src/quality/test-requests.scope.integration.spec.ts`

Expected: 新增策略字段无法通过 DTO 或 service，`exceptions` 视图和摘要字段不存在导致失败。

- [ ] **Step 3: 新建 `test-request-scope-summary.ts` 并固定计算规则**

导出以下类型和函数，避免把模块后代、候选纳入条件和例外规则复制到多个 service：

```ts
export type ScopeModuleStrategy = 'AI_RECOMMENDED' | 'ALL';
export type ScopeExceptionReason = 'AI_NEW_CASE' | 'PENDING_REVIEW' | 'AI_EXCLUDED';

export interface ScopeModuleSummary {
  moduleId: string;
  libraryId: string;
  moduleName: string;
  totalCount: number;
  includedCount: number;
  aiRecommendedCount: number;
  exceptionCount: number;
  status: 'ALL' | 'PARTIAL' | 'NONE';
}

export function scopeExceptionReason(candidate: {
  action: string;
  resolution: string;
  sourceDefinitionId?: string | null;
  decisionNote?: string | null;
}): ScopeExceptionReason | null;
```

`scopeExceptionReason` 的规则固定为：没有 `sourceDefinitionId` 且 `action === 'CREATE'` 返回 `AI_NEW_CASE`；`resolution === 'PENDING'` 且没有人工 `decisionNote` 返回 `PENDING_REVIEW`；`action === 'EXCLUDE'` 且没有人工 `decisionNote` 返回 `AI_EXCLUDED`；其余返回 `null`。模块摘要按模块及所有后代模块查询 ACTIVE 定义、候选和纳入状态，不能从当前分页页内数据推算。

- [ ] **Step 4: 增加 DTO 和 browse 类型校验**

在 `UpdateTestScopeModuleDto` 增加可选字段：

```ts
@IsOptional()
@IsIn(['AI_RECOMMENDED', 'ALL'])
strategy?: ScopeModuleStrategy;
```

将 `ScopeBrowseQuery.view` 扩展为 `selected | library | exceptions`，为 `TestDesignCandidate` 的返回装饰预留 `exceptionReason`。旧查询仍接受未传 `view` 的兼容入口。

- [ ] **Step 5: 运行 API 测试并提交边界代码**

Run: `pnpm --filter flowx-api exec vitest run src/quality/test-requests.scope.integration.spec.ts`

Expected: DTO 和共享计算相关断言通过；尚未接入 service 的测试可以继续保持失败，下一任务完成后全部通过。

Commit: `git add apps/api/src/quality/dto/test-request.dto.ts apps/api/src/quality/test-request-scope-browse.ts apps/api/src/quality/test-request-scope-summary.ts apps/api/src/quality/test-requests.scope.integration.spec.ts && git commit -m "补充提测范围模块批量契约"`

## Task 2: 接入 API 模块摘要、例外视图和兼容批量动作

**Files:**

- Modify: `apps/api/src/quality/test-request-scope-browse.ts`
- Modify: `apps/api/src/quality/test-requests.service.ts`
- Modify: `apps/api/src/quality/case-libraries.controller.ts`
- Modify: `apps/api/src/quality/case-libraries.service.ts`
- Modify: `apps/api/src/quality/test-requests.scope.integration.spec.ts`
- Modify: `apps/api/src/quality/case-libraries.service.spec.ts`

- [ ] **Step 1: 实现 `view=exceptions` 服务端分页**

在 `browseScope` 中接受 `exceptions`，复用当前 `libraryId`、`moduleId`、`q` 和分页过滤；查询候选后用 `scopeExceptionReason` 装饰并过滤掉 `null`，返回 `exceptionReason` 和现有 `sourceDefinition`。`selected` 和 `library` 的返回结构保持不变，`summary.included`、`matchingIncluded`、`available` 继续使用全局/当前目录语义。

- [ ] **Step 2: 给模块列表增加 `testRequestId` 摘要上下文**

在 `case-libraries.controller.ts` 的 `listModules` 查询类型中增加 `testRequestId?: string`，在 service 中传入 `listModules`。不传时保持现有库管理行为；传入时验证提测存在、属于当前工作区和项目，再为当前分页模块附加 `scopeSummary?: ScopeModuleSummary`。模块摘要查询必须使用 `scopeModuleIds` 覆盖子模块和分页外用例，并只允许共享库或当前项目库。

- [ ] **Step 3: 接入 `AI_RECOMMENDED` 批量恢复并保持旧语义**

在 `TestRequestsService.updateScopeModule` 中按策略分支：

```ts
if (dto.included && dto.strategy === 'AI_RECOMMENDED') {
  // 只取后代模块中 action !== EXCLUDE 且 resolution === REJECTED 的候选
  // 通过 updateScopeDraft 恢复候选和对应 scope case，不创建缺少候选的库用例
  return this.updateScopeDraft(id, {
    scopeRevision: dto.scopeRevision,
    removedCandidateIds: [],
    restoredCandidateIds: candidateIds,
  });
}
// dto.strategy 未传且 included=true：保留旧的整模块纳入逻辑
// included=false：保留现有整模块移除逻辑
```

无可恢复候选时直接返回当前 request，不递增 `scopeRevision`。模块后代、权限、确认快照和过期版本继续由现有事务校验保护。

- [ ] **Step 4: 补齐 API 集成和 service 测试**

覆盖以下真实行为：

- `AI_RECOMMENDED` 不创建未被 AI 推荐的库用例，能恢复被人工移除的推荐候选；
- 未传 `strategy` 的旧 `included=true` 仍整模块纳入；
- `included=false` 覆盖子模块和 100 条以上分页外用例；
- `view=exceptions` 只返回待审阅候选并带 `exceptionReason`；
- `testRequestId` 摘要按项目/共享库隔离，跨项目和快照确认后均拒绝；
- 过期 `scopeRevision`、重复恢复、空模块和事务失败不产生部分更新。

- [ ] **Step 5: 运行 API 质量测试**

Run: `pnpm --filter flowx-api exec vitest run src/quality/test-requests.scope.integration.spec.ts src/quality/case-libraries.service.spec.ts`

Expected: 所有范围事务、模块摘要、旧客户端兼容和权限测试通过。

- [ ] **Step 6: 提交 API 实现**

Commit: `git add apps/api/src/quality/test-request-scope-browse.ts apps/api/src/quality/test-requests.service.ts apps/api/src/quality/case-libraries.controller.ts apps/api/src/quality/case-libraries.service.ts apps/api/src/quality/test-requests.scope.integration.spec.ts apps/api/src/quality/case-libraries.service.spec.ts && git commit -m "支持提测范围模块摘要与 AI 批量恢复"`

## Task 3: 同步 Web 类型和 API helper

**Files:**

- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

- [ ] **Step 1: 增加前端契约类型**

在 `types.ts` 增加：

```ts
export interface TestRequestScopeModuleSummary {
  moduleId: string;
  libraryId: string;
  moduleName: string;
  totalCount: number;
  includedCount: number;
  aiRecommendedCount: number;
  exceptionCount: number;
  status: 'ALL' | 'PARTIAL' | 'NONE';
}
```

给 `TestCaseModule` 增加 `scopeSummary?: TestRequestScopeModuleSummary`，给 `TestDesignCandidate` 增加 `exceptionReason?: 'AI_NEW_CASE' | 'PENDING_REVIEW' | 'AI_EXCLUDED' | null`，给 `TestRequestScopeDraft.summary` 改为包含 `included`、`matchingIncluded`、`available`、`aiRecommended`、`exceptionCount` 的可选结构。

- [ ] **Step 2: 更新 API helper 参数和返回类型**

将 `getTestRequestScopeDraft` 的 `view` 扩展为 `selected | library | exceptions`；将 `getTestCaseModules` query 增加 `testRequestId?: string`；将 `updateTestRequestScopeModule` payload 增加 `strategy?: 'AI_RECOMMENDED' | 'ALL'`。query string 只在字段存在时发送，旧调用生成的 URL 保持不变。

- [ ] **Step 3: 先写 API helper 断言并运行**

在 `apps/web/src/api.test.ts` 断言：

```ts
await api.getTestCaseModules('library-1', { testRequestId: 'request-1', parentId: 'null' });
expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('testRequestId=request-1');

await api.getTestRequestScopeDraft('request-1', { view: 'exceptions', moduleId: 'module-1' });
expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('view=exceptions');

await api.updateTestRequestScopeModule('request-1', {
  scopeRevision: 4,
  moduleId: 'module-1',
  included: true,
  strategy: 'AI_RECOMMENDED',
});
```

Run: `pnpm --filter flowx-web exec vitest run src/api.test.ts`

Expected: 在 helper 尚未更新前新增断言失败。

- [ ] **Step 4: 实现 helper 并复跑测试**

保持所有旧调用的 query 顺序和默认参数兼容，新增字段通过现有 `queryString` 透传。运行同一命令，Expected: `api.test.ts` 全部通过。

- [ ] **Step 5: 提交契约同步**

Commit: `git add apps/web/src/types.ts apps/web/src/api.ts apps/web/src/api.test.ts && git commit -m "同步提测范围模块摘要前端契约"`

## Task 4: 实现模块目录摘要和批量操作组件

**Files:**

- Modify: `apps/web/src/pages/quality/QualityScopeDirectory.tsx`
- Create: `apps/web/src/pages/quality/QualityScopeModuleOverview.tsx`
- Modify: `apps/web/src/pages/quality/QualityScopeDraftPanel.tsx`

- [ ] **Step 1: 先更新组件测试到模块批量行为**

在 `QualityScopeDraftPanel.test.tsx` 增加并先运行以下行为断言：

- 首屏显示“预计提测、AI 推荐、待处理例外、覆盖变更点”，默认请求 `view=exceptions`；
- 目录请求带 `testRequestId`，模块行显示 `scopeSummary` 的纳入数和例外数；
- 点击“纳入 AI 推荐”调用 `strategy: 'AI_RECOMMENDED'`；
- 点击“移除全部”先显示模块名称和影响条数，取消不发请求，确认后发送 `included:false`；
- “纳入 AI 推荐”不会把 `library` 视图中的无候选用例加入范围；
- 切换“全部用例”后勾选/详情查看仍保留模块和筛选状态；
- 批量写入失败后保留模块选择、例外列表和错误提示，确认按钮禁用直到重新同步。

Run: `pnpm --filter flowx-web exec vitest run src/pages/quality/QualityScopeDraftPanel.test.tsx`

Expected: 新增断言因当前面板没有模块摘要和策略按钮而失败。

- [ ] **Step 2: 让目录加载并呈现模块摘要**

给 `QualityScopeDirectory` 增加 `testRequestId` prop，递归调用 `api.getTestCaseModules(libraryId, { parentId, page, pageSize: 20, testRequestId })`。模块节点保留现有展开/筛选行为，追加 `includedCount/totalCount`、`exceptionCount` 和 `ALL/PARTIAL/NONE` 状态；未传摘要时不显示伪造数字。

- [ ] **Step 3: 新建 `QualityScopeModuleOverview`**

组件 props 明确为当前模块摘要、锁定状态、保存状态和批量回调。组件显示：

```tsx
<Button onClick={() => onBatch({ included: true, strategy: 'AI_RECOMMENDED' })}>
  纳入 AI 推荐
</Button>
<Button variant="outline" onClick={() => setConfirmRemoveAll(true)}>
  移除全部
</Button>
```

“移除全部”确认弹层显示模块名、当前纳入数和“取消/移除全部”两个按钮；取消不触发回调。组件只负责呈现和回调，不直接调用 API。

- [ ] **Step 4: 重组 `QualityScopeDraftPanel` 数据流**

保留现有 `scopeWrites` 串行队列、跨页签等待、静默轮询和 `scopeRevision`，做以下调整：

1. 由 `draft.summary` 渲染顶部四项摘要；AI 推荐和例外数量缺失时显示“—”。
2. `view` 默认使用 `exceptions`，按钮改为“只显示例外 / 全部用例”；全部用例继续调用 `view=library`。
3. 目录选择改变 `moduleId`、页码和详情后，重新读取当前视图，不改变范围。
4. 当前模块存在时渲染 `QualityScopeModuleOverview`；批量回调进入现有 `enqueue`，AI 推荐发送策略，移除全部发送 `included:false`。
5. 例外行显示 `exceptionReason` 的中文标签；普通库用例仍显示复选框、标题、模块和优先级；详情继续复用 `QualityScopeCaseDetails`。
6. 批量写入完成后统一静默刷新，失败保留当前内容并阻止确认；确认摘要列出已加载模块摘要和总例外数，再调用 `prepareTestRequest`。
7. 已确认快照、提测已开始、AI 生成中和错误状态继续锁定写入，目录/搜索/详情可读。

- [ ] **Step 5: 运行范围组件测试并修复交互**

Run: `pnpm --filter flowx-web exec vitest run src/pages/quality/QualityScopeDraftPanel.test.tsx`

Expected: 范围组件测试全部通过，且原有连续操作、旧响应隔离、只读和 AI 新用例保存测试保持通过。

- [ ] **Step 6: 提交 Web 工作台实现**

Commit: `git add apps/web/src/pages/quality/QualityScopeDirectory.tsx apps/web/src/pages/quality/QualityScopeModuleOverview.tsx apps/web/src/pages/quality/QualityScopeDraftPanel.tsx apps/web/src/pages/quality/QualityScopeDraftPanel.test.tsx && git commit -m "重设计提测范围模块批量工作台"`

## Task 5: 同步用户手册、系统契约和变更记录

**Files:**

- Modify: `docs/quality-foundation.md`
- Modify: `docs/system-design.md`
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 更新质量基础契约**

在 `docs/quality-foundation.md` 的提测范围工作台章节记录：模块列表可携带 `testRequestId` 摘要、草稿新增 `view=exceptions`、模块批量策略 `AI_RECOMMENDED | ALL`、旧客户端未传策略仍整模块纳入，以及 `exceptionReason` 的语义。

- [ ] **Step 2: 更新系统设计**

在 `docs/system-design.md` 的提测范围补充中记录服务端计算模块后代摘要、例外过滤、CAS 写入和旧客户端兼容，不新增数据库表或协议工具。

- [ ] **Step 3: 更新用户手册并同步镜像**

把 `docs/user-manual.md` 的测试闭环改为“模块摘要 → 纳入 AI 推荐/移除全部 → 只审阅例外 → 确认并分派”，说明移除全部需要明确确认，AI 新用例仍需人工保存。复制到 `apps/web/public/user-manual.md` 后执行：

```bash
cmp -s docs/user-manual.md apps/web/public/user-manual.md
```

Expected: 命令退出码为 0。

- [ ] **Step 4: 更新未发布变更**

在 `CHANGELOG.md` 的 2026-11-11 未发布条目记录页面交互、API 兼容和本地工具适配结论。

- [ ] **Step 5: 提交文档同步**

Commit: `git add docs/quality-foundation.md docs/system-design.md docs/user-manual.md apps/web/public/user-manual.md CHANGELOG.md && git commit -m "同步提测范围模块确认文档"`

## Task 6: 全量验证和交付检查

**Files:**

- No new files; inspect all prior changes.

- [ ] **Step 1: 运行 API 测试和构建**

Run: `pnpm --filter flowx-api test`

Run: `pnpm --filter flowx-api build`

Expected: API 全量测试和 TypeScript build 通过。

- [ ] **Step 2: 运行 Web 测试和构建**

Run: `pnpm --filter flowx-web test --run`

Run: `pnpm --filter flowx-web build`

Expected: Web 全量测试和 Vite build 通过；覆盖批量确认、错误恢复、只读、分页和 API helper。

- [ ] **Step 3: 运行仓库级检查**

Run: `pnpm check`

Run: `git diff --check`

Run: `cmp -s docs/user-manual.md apps/web/public/user-manual.md`

Expected: 三个命令退出码均为 0。

- [ ] **Step 4: 做一次浏览器回归**

启动 Web/API 开发服务，用隔离测试数据打开提测详情的“测试范围”页，确认：首屏摘要、模块节点计数、纳入 AI 推荐、移除全部确认、例外/全部切换、详情抽屉、网络失败恢复、确认后进入分派。检查浏览器 console 无新增 error/warn。

- [ ] **Step 5: 复核交付边界**

执行 `git status --short`，确认没有 `dist/`、数据库、`.flowx-data`、登录态或未授权文件；核对 `flowx-local`、MCP、CLI 和 `@flowx-ai/protocol` 未发生非预期改动；汇报测试、构建、文档镜像和本地适配结果。

## 计划自检

- 规格中的版本级总览、模块状态、AI 推荐恢复、移除全部确认、例外视图、详情查看、确认分派、只读锁定、错误恢复和本地适配均在 Task 1–6 有对应步骤。
- 全文未使用 `TBD`、`TODO` 或未定义的“稍后补充”步骤；API 策略、例外枚举、前端字段和测试调用保持一致。
- 明确选择扩展 `GET /quality/case-libraries/:libraryId/modules?testRequestId=...`，不再保留两种 API 方案；旧客户端兼容行为固定为未传策略时 `ALL`。
