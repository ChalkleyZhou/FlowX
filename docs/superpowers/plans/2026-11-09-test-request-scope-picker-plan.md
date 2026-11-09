# 提测范围树状穿梭框 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将提测范围工作台改为用例库树状双栏穿梭框，列表仅保留用例标题、层级和必要标记，并支持 AI 默认范围与人工补选。

**Architecture:** 后端复用现有 `scope-draft` 和 `scope/cases` 业务服务，补齐 Web API helper 与前端类型；前端在 `QualityScopeDraftPanel` 内按需加载库、模块和用例，维护左右两棵树及批量选择状态。确认范围继续使用现有 `prepareTestRequest` 和 `scopeRevision` 乐观并发机制。

**Tech Stack:** React 18、TypeScript、Tailwind、Vitest、NestJS、Prisma。

---

### Task 1: 扩展前端 API 类型与人工加入入口

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/types.ts`
- Test: `apps/web/src/api.test.ts`

- [ ] **Step 1: 为用例树定义轻量节点数据依赖**

复用 `TestCaseLibrary`、`TestCaseModule`、`TestCaseDefinition`，不把 `steps`、`expected` 等详情映射到 UI 节点。

- [ ] **Step 2: 添加 `addTestRequestScopeCases` API helper**

调用 `POST /quality/test-requests/:id/scope/cases`，payload 使用 `{ selections: Array<{ caseId; reason; impactLevel }> }`，返回 `TestRequest`。

- [ ] **Step 3: 补 API helper 测试**

断言请求方法、路径和批量 selections 正确透传。

### Task 2: 重构范围面板为双栏树状穿梭框

**Files:**
- Modify: `apps/web/src/pages/quality/QualityScopeDraftPanel.tsx`
- Test: `apps/web/src/pages/quality/QualityScopeDraftPanel.test.tsx`（新建）

- [ ] **Step 1: 先写交互失败测试**

覆盖 AI 候选默认出现在右侧、左侧库/模块/用例树可展开、按节点批量选择、加入/移出按钮、列表不出现 `steps`/`expected`/`matchReason` 文本、AI 新用例标记和确认按钮。

- [ ] **Step 2: 建立按需加载状态**

首屏加载库列表；展开库时加载模块；展开模块时按 `workspaceId`、`libraryIds`、`moduleIds` 请求用例分页。维护已加载节点缓存和搜索词，避免一次性加载全部用例。

- [ ] **Step 3: 将 AI 候选归一化为右侧树节点**

`sourceDefinition` 映射为正式库/模块/用例；`CREATE` 映射为 AI 新用例节点并保留候选 ID；没有来源定义时使用“AI 生成”虚拟库/模块。右侧节点只输出 `title`、`priority`、层级和来源标签。

- [ ] **Step 4: 实现左右树和批量移动**

左侧支持库、模块、用例三级复选；中间提供“加入范围”和“移出范围”。加入正式用例调用 `addTestRequestScopeCases`，移除 AI 候选调用 `updateTestRequestScopeDraft`；成功后刷新草稿并清空临时选择。父节点选择只作用于当前已加载子节点，并显示已选数量。

- [ ] **Step 5: 保留 AI 新用例人工保存入口**

将保存目标库/模块选择移入 AI 新用例节点的次级按钮或简洁菜单，不在页面顶部长期占位；保存后只更新节点的“已保存”标记。

- [ ] **Step 6: 收敛页面文案与状态**

顶部只显示 AI 推荐、当前范围、已移除；分析中使用局部 loading；空状态、错误状态、范围确认和轮询保留现有行为。删除分页候选列表、步骤数量、匹配理由和详情文本。

- [ ] **Step 7: 运行范围面板测试并修复**

运行 `pnpm --filter flowx-web test -- QualityScopeDraftPanel`，确认测试通过。

### Task 3: 更新用户手册与变更记录

**Files:**
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 更新提测流程文案**

将范围工作台描述为“用例库树状双栏穿梭框”，说明 AI 默认纳入、批量加入/移出和列表不展示用例详情。

- [ ] **Step 2: 校验手册镜像一致**

运行 `cmp -s docs/user-manual.md apps/web/public/user-manual.md`。

### Task 4: 全量 Web 验证与提交

**Files:**
- No new files.

- [ ] **Step 1: 运行 Web 测试、构建和 diff 检查**

运行 `pnpm --filter flowx-web test`、`pnpm --filter flowx-web build`、`git diff --check`。

- [ ] **Step 2: 检查适配结论**

确认本次没有修改 MCP/CLI/协议；本地 Agent 继续使用确认后的测试计划和执行接口。

- [ ] **Step 3: 提交中文变更**

使用 `git add` 添加实现、测试、文档和变更记录，提交信息为 `简化提测范围树状穿梭交互`。
