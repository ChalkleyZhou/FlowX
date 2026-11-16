# 版本工作台列表统一实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将版本工作台改为需求列表风格的只读表格，通过 `全部 / 需求 / 问题 / 缺陷` Tab 查看当前版本数据，并保留各类型专属字段。

**Architecture:** `VersionWorkItemsPage` 继续负责版本切换、Tab、搜索和列表编排；全部 Tab 复用当前版本工作项接口，需求/问题/缺陷 Tab 分别复用现有分页 API，表格使用需求列表的结构和视觉约定。缺陷分页接口增加 `versionId` 查询条件，旧请求行为保持不变。

**Tech Stack:** React、TypeScript、React Router、Radix Tabs、Tailwind、NestJS、Prisma、Vitest。

---

### Task 1: 扩展缺陷列表的版本筛选

**Files:**
- Modify: `apps/api/src/review-artifacts/review-artifacts.controller.ts:70-73`
- Modify: `apps/api/src/review-artifacts/review-artifacts.service.ts:401-414`
- Test: `apps/api/src/projects/server-pagination.spec.ts:44-53`

- [x] **Step 1: 写失败测试**

在 `getBugsPage` 分页测试中，把查询参数增加 `versionId: 'v'`，并断言 `findMany` 的 `where` 同时包含 `projectId`（如传入）和 `versionId: 'v'`；问题列表已经通过 `WorkItemsService.listGlobal` 支持 `versionId`，不重复修改旧的审查兼容方法。控制器测试保持无参数调用仍传 `{}`。

- [x] **Step 2: 运行后端定向测试确认失败**

运行：

```bash
pnpm --filter flowx-api exec vitest run src/projects/server-pagination.spec.ts
```

预期：新增的 `versionId` 断言失败，因为 `getBugsPage` 当前没有把该条件加入查询。

- [x] **Step 3: 实现版本过滤**

将 controller 查询类型和 service 参数类型都增加 `versionId?: string`，并在缺陷 `where` 中加入：

```ts
...(query.versionId ? { versionId: query.versionId } : {}),
```

不改变无 `versionId` 请求的查询和统计逻辑。

- [x] **Step 4: 运行定向测试确认通过**

再次运行同一命令，预期 `server-pagination.spec.ts` 全部通过。

### Task 2: 调整版本工作台的数据状态和 Tab 请求

**Files:**
- Modify: `apps/web/src/pages/VersionWorkItemsPage.tsx`
- Modify: `apps/web/src/pages/VersionWorkspacePage.test.tsx`

- [x] **Step 1: 写失败测试**

扩展 `VersionWorkspacePage.test.tsx` 的 API mock，增加 `getRequirements`、`getIssues`、`getBugs`；增加断言：

```ts
expect(container.textContent).toContain('全部');
expect(container.textContent).toContain('需求');
expect(container.textContent).toContain('问题');
expect(container.textContent).toContain('缺陷');
expect(container.textContent).not.toContain('执行项');
```

新增测试点击“需求” Tab 后，请求：

```ts
expect(api.getRequirements).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', versionId: 'version-1', page: 1, pageSize: 20 }));
```

- [x] **Step 2: 运行 Web 定向测试确认失败**

运行：

```bash
pnpm --filter flowx-web exec vitest run src/pages/VersionWorkspacePage.test.tsx
```

预期：Tab 文案和需求请求断言失败。

- [x] **Step 3: 实现 Tab 和 URL 状态**

在 `VersionWorkItemsPage` 中：

- 使用 `useSearchParams` 读取和写入 `kind`，缺省为 `ALL`；使用 `Tabs`、`TabsList`、`TabsTrigger` 渲染四个 Tab。
- 保留 `versionId` 与版本切换逻辑；Tab 切换时把 `kind` 写入 URL，清空当前数据并重置对应分页。
- `ALL` 继续调用 `api.listVersionWorkItems`；需求、问题、缺陷分别调用 `api.getRequirements`、`api.getIssues`、`api.getBugs`，均传 `projectId`、`versionId`、`q`、`page`、`pageSize: 20`。
- 删除行内 `update` 调用和状态/负责人/备注编辑控件，保留创建、版本配置和详情入口。
- 为全部视图保留游标翻页，为类型视图使用 `ListPagination`，切换 Tab 后从第一页开始。

- [x] **Step 4: 运行定向测试确认通过**

运行：

```bash
pnpm --filter flowx-web exec vitest run src/pages/VersionWorkspacePage.test.tsx
```

预期：版本默认打开、Tab 和类型请求测试通过。

### Task 3: 实现需求/问题/缺陷专属表格

**Files:**
- Modify: `apps/web/src/pages/VersionWorkItemsPage.tsx`
- Test: `apps/web/src/pages/VersionWorkspacePage.test.tsx`

- [x] **Step 1: 写失败测试**

分别给三个类型 mock 一条记录，断言：

- 需求显示“需求变更时间”“最新变更内容”“备注”；
- 问题显示“来源工作流”“分支”；
- 缺陷显示“严重级别”“来源工作流”；
- 三个类型的表格都没有“执行项”表头；
- 行内没有用于状态修改的 `select`，详情链接均指向 `/work-items/:id`。

- [x] **Step 2: 运行定向测试确认失败**

运行同一 Vitest 命令，预期专属列和只读断言失败。

- [x] **Step 3: 实现表格渲染**

复用需求列表的表格 class、`ListToolbar`、`ListPagination`、`Badge`、`EmptyState` 和格式化函数：

- 需求列使用 `Requirement` 的 `description`、`priority`、`createdByName`、`createdAt`、`latestChangeAt`、`latestChangeContent`、`remark` 和原型导入状态。
- 问题列使用 `Issue` 的 `description`、`status`、`priority`、`sourceWorkflowRun`、`branchName`。
- 缺陷列使用 `Bug` 的 `description`、`severity`、`priority`、`status`、`workflowRun/sourceWorkflowRun`、`branchName`。
- 全部列使用公共 `WorkItem` 字段，类型以 Badge 展示。
- 所有表格操作列仅保留“详情”按钮，表格状态和负责人展示为文本或 Badge。
- 搜索、加载、错误、空结果和分页保持现有页面的可访问标签和中文提示。

- [x] **Step 4: 运行定向测试确认通过**

运行：

```bash
pnpm --filter flowx-web exec vitest run src/pages/VersionWorkspacePage.test.tsx
```

预期：四种 Tab 的字段和只读交互全部通过。

### Task 4: 文档、全量验证与交付

**Files:**
- Modify: `CHANGELOG.md`
- Check: `docs/user-manual.md`, `apps/web/public/user-manual.md`

- [x] **Step 1: 更新用户可见变更**

在 `CHANGELOG.md` 当前未发布条目的 2026-11-16 变更中记录：版本工作台改为 Tab、领域专属只读表格、移除执行项列，并确认用户手册中版本工作台描述仍准确；若手册缺少该交互则同步更新源文件和 Web 镜像。

- [x] **Step 2: 运行受影响测试和构建**

运行：

```bash
pnpm --filter flowx-api exec vitest run src/projects/server-pagination.spec.ts
pnpm --filter flowx-web test
pnpm --filter flowx-web build
```

预期：后端定向测试、Web 全量测试和构建全部退出码为 0。

- [x] **Step 3: 运行交付检查**

运行：

```bash
git diff --check
cmp -s docs/user-manual.md apps/web/public/user-manual.md
git status --short --branch
```

确认没有无关文件和生成物变更。

- [x] **Step 4: 提交并推送**

```bash
git add apps/api/src/review-artifacts/review-artifacts.controller.ts \
  apps/api/src/review-artifacts/review-artifacts.service.ts \
  apps/api/src/projects/server-pagination.spec.ts \
  apps/web/src/pages/VersionWorkItemsPage.tsx \
  apps/web/src/pages/VersionWorkspacePage.test.tsx \
  docs/superpowers/plans/2026-11-16-version-workspace-list-plan.md \
  CHANGELOG.md
git commit -m "统一版本工作台列表交互"
git push origin main
```

