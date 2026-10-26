# 需求列表筛选优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化需求列表筛选，移除无关的 Codex/Cursor 选择，并支持按发布版本、规划状态和优先级组合筛选。

**Architecture:** 继续使用 `RequirementsPage` 的一次性数据加载和本地过滤；以 URL query 作为筛选状态来源，保留 `launchRequirementId` 等非筛选参数。版本选项从项目数据派生并随工作区/项目联动，不新增后端接口。

**Tech Stack:** React、TypeScript、React Router `useSearchParams`、Radix Select、Vitest、React DOM 测试工具。

---

### Task 1: 为筛选行为补失败测试

**Files:**
- Modify: `apps/web/src/pages/RequirementsPage.test.tsx`

- [ ] **Step 1: 扩展测试夹具，准备两个项目、多个版本和不同规划状态/优先级的需求。**

在现有 `requirement` 夹具基础上新增第二个项目及需求，保证测试可以区分 `versionId`、`planningStatus` 和 `priority`，并让 `api.getProjects` 返回两个项目。

- [ ] **Step 2: 添加 URL 恢复和组合筛选测试。**

渲染 `/requirements?workspaceId=workspace-1&projectId=project-1&versionId=ver-2&planningStatus=IN_PROGRESS&priority=HIGH`，断言页面只显示匹配需求、筛选控件显示对应值、Codex/Cursor 默认执行器控件不再出现在列表筛选区。

- [ ] **Step 3: 添加项目/工作区联动清理测试。**

先从带有 `projectId` 与 `versionId` 的 URL 渲染，切换项目后断言版本参数被清除；切换工作区后断言项目和版本参数都被清除。

- [ ] **Step 4: 添加清除筛选和空结果测试。**

断言点击“清除筛选”会恢复全量需求并移除筛选 query；当筛选没有匹配结果时显示“当前筛选条件下没有需求，请调整筛选或清除条件”。

- [ ] **Step 5: 运行新增测试确认它们按预期失败。**

Run: `pnpm --filter flowx-web test -- RequirementsPage.test.tsx`

Expected: 新增断言失败，失败原因是页面尚未提供版本/规划状态/优先级 URL 筛选及清除交互。

### Task 2: 实现 URL 驱动的筛选状态和联动选项

**Files:**
- Modify: `apps/web/src/pages/RequirementsPage.tsx`

- [ ] **Step 1: 定义筛选常量和 URL 读取辅助逻辑。**

在页面顶部定义 `ALL_FILTER_VALUE`、规划状态选项、优先级选项，并从 `searchParams` 派生 `selectedWorkspaceId`、`selectedProjectId`、`selectedVersionId`、`selectedPlanningStatus` 和 `selectedPriority`；保留默认执行器 state 给启动/创建弹窗使用。

- [ ] **Step 2: 实现版本选项派生。**

从当前工作区下的项目收集版本；选中项目时只返回该项目版本，未选项目时返回带项目名称的版本选项。使用稳定的 version ID 作为 Select value，并过滤已不存在的项目/版本。

- [ ] **Step 3: 实现统一 query 更新函数和层级清理。**

增加 `updateFilterQuery`：只更新筛选参数、保留其它 query；工作区变更删除 `projectId`/`versionId`，项目变更删除 `versionId`，版本/规划状态/优先级变更只更新自身参数；`clearFilters` 删除全部筛选参数并使用 `replace: true`。

- [ ] **Step 4: 替换本地过滤逻辑。**

让 `filteredRequirements` 同时匹配工作区、项目、版本、规划状态和优先级；工作区和项目的 Select 由 URL 值驱动，并在数据刷新后清理无效参数。

- [ ] **Step 5: 更新筛选区和结果状态。**

从 `ListToolbar` 删除 Codex/Cursor Select；加入版本、规划状态、优先级 Select 和“清除筛选”按钮。根据是否存在任意筛选条件选择全空状态文案，并在需求徽标中增加发布版本。

- [ ] **Step 6: 运行页面测试确认通过。**

Run: `pnpm --filter flowx-web test -- RequirementsPage.test.tsx`

Expected: RequirementsPage 全部测试通过。

### Task 3: 更新用户文档并完成验证

**Files:**
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 在需求列表使用说明中记录筛选项。**

说明需求列表支持工作区、项目、发布版本、规划状态和优先级组合筛选，筛选条件会保存在 URL；Codex/Cursor 只在创建或启动流程时选择。

- [ ] **Step 2: 同步 Web 手册镜像。**

将 `docs/user-manual.md` 的完整内容复制到 `apps/web/public/user-manual.md`，保持两者一致。

- [ ] **Step 3: 运行 Web 测试、构建和文档检查。**

Run: `pnpm --filter flowx-web test`

Run: `pnpm --filter flowx-web build`

Run: `cmp -s docs/user-manual.md apps/web/public/user-manual.md && git diff --check`

Expected: 测试、构建、镜像一致性和 diff 检查均成功。

- [ ] **Step 4: 检查最终 diff 和工作区边界。**

Run: `git status --short && git diff --stat`

Expected: 只包含本次需求列表页面、测试、用户手册、CHANGELOG 和计划文件的新增修改，以及提交前已存在的用户修改；不修改生成物或 `.flowx-data`。

