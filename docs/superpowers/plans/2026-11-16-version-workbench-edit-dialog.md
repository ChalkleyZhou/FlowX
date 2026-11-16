# 版本工作台编辑弹框 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让版本工作台三个类型 Tab 在当前页面通过弹框编辑工作项，并让统一工作项详情按来源列表返回。

**Architecture:** 新增只负责常用字段编辑的 `WorkItemEditDialog`，由 `VersionWorkItemsPage` 管理当前编辑项和列表刷新；普通列表链接通过 React Router location state 传递安全的返回路径，`WorkItemDetailPage` 读取该状态生成返回入口。沿用现有 `api.updateWorkItem`、`Dialog`、`PagedSelect` 和 Toast，不修改后端契约。

**Tech Stack:** React, TypeScript, React Router, Radix/shadcn Dialog, Vitest, Vite。

---

### Task 1: 新增通用工作项编辑弹框

**Files:**
- Create: `apps/web/src/components/WorkItemEditDialog.tsx`
- Test: `apps/web/src/components/WorkItemEditDialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

覆盖三个类型的标题、编号、状态只读展示，标题/描述/优先级/版本/备注回填；空标题禁止保存；保存成功将 `updatedAt` 传给 `api.updateWorkItem` 并回调更新对象；保存失败保留草稿和错误提示；取消不调用 API。

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter flowx-web exec vitest run src/components/WorkItemEditDialog.test.tsx`

Expected: FAIL because the component and its test fixture do not exist.

- [ ] **Step 3: Implement the dialog**

定义 props：

```ts
{
  workItem: WorkItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (workItem: WorkItem) => void;
}
```

使用 `draftFrom(workItem)` 初始化 `{ title, description, priority, versionId, remark }`；字段使用 `Input`、`Textarea`、`Select` 和 `PagedSelect`。弹框头部展示类型、`displayCode ?? id` 和只读状态。保存调用 `api.updateWorkItem(workItem.id, { ...draft, title: draft.title.trim(), description: draft.description.trim(), remark: draft.remark.trim(), versionId: draft.versionId || null, updatedAt: workItem.updatedAt })`；成功调用 `onSaved(updated)`，失败设置错误且不关闭弹框。保存期间禁用 fieldset 和关闭操作。

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `pnpm --filter flowx-web exec vitest run src/components/WorkItemEditDialog.test.tsx`

Expected: PASS for all dialog behavior tests.

- [ ] **Step 5: Commit the component**

```bash
git add apps/web/src/components/WorkItemEditDialog.tsx apps/web/src/components/WorkItemEditDialog.test.tsx
git commit -m "新增工作项编辑弹框"
```

### Task 2: 将版本工作台三个 Tab 接入弹框

**Files:**
- Modify: `apps/web/src/pages/VersionWorkItemsPage.tsx`
- Modify: `apps/web/src/components/RequirementListTable.tsx`
- Test: `apps/web/src/pages/VersionWorkspacePage.test.tsx`

- [ ] **Step 1: Extend the existing page tests**

把三个 Tab 的原详情链接断言改为点击“编辑”后出现对应弹框；补充保存成功后调用 `api.updateWorkItem`、弹框关闭并刷新当前列表的断言；补充保存版本改为其他版本时当前列表重新读取的断言。

- [ ] **Step 2: Run the focused page tests and verify the new assertions fail**

Run: `pnpm --filter flowx-web exec vitest run src/pages/VersionWorkspacePage.test.tsx`

Expected: FAIL because the page still renders detail links and has no edit dialog state.

- [ ] **Step 3: Replace detail actions with the dialog entry**

在 `VersionWorkItemsPage` 增加 `editingItem` 状态和 `WorkItemEditDialog`。将 `DetailButton` 改为接受 `item` 和 `onEdit`，按钮文案改为“编辑”；`IssueTable`、`BugTable` 增加 `onEdit` props；需求表通过 `RequirementListTable` 的新增 `onOpen` prop，在标题点击和操作列都打开同一个弹框。保存回调关闭弹框并调用 `load(typedPage)`，保留当前 `projectId`、`versionId`、`kind`、搜索和分页。

- [ ] **Step 4: Run the focused page tests and verify they pass**

Run: `pnpm --filter flowx-web exec vitest run src/pages/VersionWorkspacePage.test.tsx src/components/WorkItemEditDialog.test.tsx`

Expected: PASS，且三个类型都不再产生 `/work-items/:id` 的详情跳转。

- [ ] **Step 5: Commit the workbench integration**

```bash
git add apps/web/src/pages/VersionWorkItemsPage.tsx apps/web/src/pages/VersionWorkspacePage.test.tsx apps/web/src/components/RequirementListTable.tsx
git commit -m "版本工作台改用工作项编辑弹框"
```

### Task 3: 让统一详情按来源列表返回

**Files:**
- Modify: `apps/web/src/components/RequirementListTable.tsx`
- Modify: `apps/web/src/pages/RequirementsPage.tsx`
- Modify: `apps/web/src/pages/IssuesPage.tsx`
- Modify: `apps/web/src/pages/BugsPage.tsx`
- Modify: `apps/web/src/pages/WorkItemDetailPage.tsx`
- Test: `apps/web/src/pages/WorkItemDetailPage.test.tsx` or existing detail-page test file

- [ ] **Step 1: Add failing navigation tests**

验证详情页收到 `location.state.returnTo` 时返回按钮使用该路径；没有状态时返回 `/work-items`。验证需求、问题、缺陷普通列表详情链接包含当前路径和查询参数的 `returnTo` state。

- [ ] **Step 2: Run focused navigation tests and verify they fail**

Run: `pnpm --filter flowx-web exec vitest run src/pages/WorkItemDetailPage.test.tsx`

Expected: FAIL because详情页当前固定返回版本工作项，普通列表链接未传递来源。

- [ ] **Step 3: Implement safe source-aware navigation**

在 `WorkItemDetailPage` 使用 `useLocation`，读取形状为 `{ returnTo?: string }` 的 state，仅接受以 `/` 开头且不是 `//` 的路径，否则回退 `/work-items`。详情头部返回按钮改为 `<Link to={returnTo}>返回列表</Link>`。普通需求表格、问题列表和缺陷列表的详情 Link 传递 `state={{ returnTo: location.pathname + location.search }}`；需求表格通过 prop 接收 `returnTo`，避免组件直接读取路由。

- [ ] **Step 4: Run focused navigation tests and verify they pass**

Run: `pnpm --filter flowx-web exec vitest run src/pages/WorkItemDetailPage.test.tsx src/pages/RequirementsPage.test.tsx`

Expected: PASS，且从列表进入后返回原列表筛选上下文，直接访问详情回退 `/work-items`。

- [ ] **Step 5: Commit source-aware navigation**

```bash
git add apps/web/src/components/RequirementListTable.tsx apps/web/src/pages/RequirementsPage.tsx apps/web/src/pages/IssuesPage.tsx apps/web/src/pages/BugsPage.tsx apps/web/src/pages/WorkItemDetailPage.tsx apps/web/src/pages/WorkItemDetailPage.test.tsx
git commit -m "按来源恢复工作项详情返回路径"
```

### Task 4: 文档、全量验证与交付

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`

- [ ] **Step 1: Update user-facing documentation**

在版本工作台说明中写明三个 Tab 的编辑入口会打开常用字段弹框，状态在弹框中只读；在统一工作项详情说明中写明返回按钮按来源列表恢复，直接访问回到 `/work-items`。保持两个用户手册镜像一致。

- [ ] **Step 2: Run all required checks**

Run: `pnpm --filter flowx-web test`

Expected: 全部 Web 测试通过。

Run: `pnpm --filter flowx-web build`

Expected: TypeScript 编译和 Vite 构建成功。

Run: `cmp -s docs/user-manual.md apps/web/public/user-manual.md && git diff --check`

Expected: 文档镜像一致且无空白错误。

- [ ] **Step 3: Review the final diff and commit**

```bash
git status --short
git diff --stat
git add CHANGELOG.md docs/user-manual.md apps/web/public/user-manual.md
git commit -m "完善版本工作台编辑与详情返回说明"
```

- [ ] **Step 4: Push the completed implementation**

```bash
git push origin main
```
