# 版本管理页面实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前项目作用域下提供独立的“版本管理”入口，并从版本进入需求、问题和缺陷组成的版本工作项列表。

**Architecture:** 复用现有 `ProjectVersionsPanel` 的版本 CRUD 和 `/projects/:projectId/versions/:versionId/work-items` 版本工作项页面，不修改需求池数据与创建流程。新增页面只负责项目作用域、页面标题和版本入口；路由与项目切换逻辑补充 `/versions`。

**Tech Stack:** React、React Router、TypeScript、Vitest、现有 FlowX UI 组件与 `ProjectVersion` API。

---

### Task 1: 为版本管理页面建立失败测试

**Files:**
- Create: `apps/web/src/pages/VersionManagementPage.test.tsx`

- [ ] **Step 1: 写测试**

测试渲染当前项目的版本名称、当前版本标记，以及进入版本工作项的链接；没有当前项目时显示项目选择提示。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter flowx-web exec vitest run src/pages/VersionManagementPage.test.tsx`

Expected: FAIL，因为 `VersionManagementPage` 尚不存在。

### Task 2: 实现版本管理页面

**Files:**
- Create: `apps/web/src/pages/VersionManagementPage.tsx`

- [ ] **Step 1: 实现项目作用域和页面结构**

使用 `useProjectScopeOptional` 读取当前项目，复用 `ProjectRequiredState`、`PageHeader`、`MetricCard` 和 `ProjectVersionsPanel`。展示版本总数、当前版本和入口说明；没有当前项目时显示项目选择提示。

- [ ] **Step 2: 运行页面测试确认通过**

Run: `pnpm --filter flowx-web exec vitest run src/pages/VersionManagementPage.test.tsx`

Expected: PASS。

### Task 3: 接入路由、导航和项目切换

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/project-scope.ts`

- [ ] **Step 1: 注册 `/versions` 路由和左侧“版本管理”菜单**

菜单链接通过 `withCurrentProject` 保留当前项目，版本详情工作项路由保持现有路径。

- [ ] **Step 2: 补充项目作用域列表路径**

将 `/versions` 加入项目切换保留路径，使切换项目后仍停留在版本管理页。

- [ ] **Step 3: 运行 Web 测试和构建**

Run: `pnpm --filter flowx-web test`

Run: `pnpm --filter flowx-web build`

Expected: 两条命令均成功。

### Task 4: 同步用户手册

**Files:**
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`

- [ ] **Step 1: 说明版本管理独立入口**

补充当前项目下从“版本管理”进入版本工作项、统一查看需求/问题/缺陷的说明，并保持两份手册镜像一致。

- [ ] **Step 2: 校验镜像和 diff**

Run: `cmp -s docs/user-manual.md apps/web/public/user-manual.md`

Run: `git diff --check`
