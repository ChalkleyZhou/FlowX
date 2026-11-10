# 提测范围单列表交互实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将提测范围页从双栏穿梭框收敛为树筛选、单列表勾选和按需详情查看，减少重复信息并提升范围确认速度。

**Architecture:** 保留 `QualityScopeDraftPanel` 作为范围草稿容器，左侧树继续按需加载用例库、模块和用例；右侧改为统一的扁平用例列表，以已选集合和视图筛选表达范围。详情通过页面内轻量抽屉/弹层按需展示，提测详情页移除重复快照明细区。现有范围草稿、补选、移除和确认 API 不变。

**Tech Stack:** React、TypeScript、Tailwind、现有 shadcn 风格 UI、Vitest + jsdom。

---

### Task 1: 更新范围工作台测试

**Files:**
- Modify: `apps/web/src/pages/quality/QualityScopeDraftPanel.test.tsx`

- [x] **Step 1: 将现有双栏断言改为单列表行为断言**

覆盖 AI 推荐默认勾选、树节点筛选、取消选中调用移除接口、切换“已选/AI 推荐”不改变选中状态、点击列表行展示详情，以及确认按钮仍提交 `scopeRevision`。

- [x] **Step 2: 运行范围组件测试并确认新增断言先失败**

Run: `pnpm --filter flowx-web exec vitest run src/pages/quality/QualityScopeDraftPanel.test.tsx`

Expected: 新增交互断言因当前双栏实现缺少目标控件而失败。

### Task 2: 实现单列表范围工作台

**Files:**
- Modify: `apps/web/src/pages/quality/QualityScopeDraftPanel.tsx`

- [x] **Step 1: 建模统一列表项和视图筛选**

以 AI 候选与树加载的正式用例合并为列表项，使用 `selectedCaseIds`、`viewFilter`、`selectedCase` 管理范围选择、视图和详情状态；删除左右两侧独立选择状态。

- [x] **Step 2: 保留按需树加载并让树节点成为列表筛选入口**

用例库和模块展开逻辑继续复用现有分页 API；点击树节点设置当前库/模块筛选，勾选树节点批量更新对应列表用例，避免再次渲染第二份范围列表。

- [x] **Step 3: 实现单列表勾选、批量操作和详情弹层**

列表提供全部、已选、AI 推荐三个视图；复选框直接加入或移出范围；点击行打开详情弹层，复用现有详情字段；AI 新用例保存入口保持独立。

- [x] **Step 4: 保留范围确认和错误/加载状态**

保留轮询、首屏加载、静默刷新、权限错误和 `scopeRevision` 确认流程；空列表、无匹配和保存失败提供现有 toast/空状态。

- [x] **Step 5: 运行组件测试并修复行为差异**

Run: `pnpm --filter flowx-web exec vitest run src/pages/quality/QualityScopeDraftPanel.test.tsx`

Expected: 范围组件测试全部通过。

### Task 3: 移除重复确认范围区并同步文档

**Files:**
- Modify: `apps/web/src/pages/quality/QualityRequestDetailPage.tsx`
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 从 scope 页签移除已确认快照明细**

保留范围工作台或分派面板，删除下方重复的快照卡片、步骤和预期结果列表；快照详情继续由执行轮次和报告页面提供。

- [x] **Step 2: 更新用户手册**

将提测范围描述改为“树筛选 + 单列表勾选 + 点击查看详情”，说明 AI 默认纳入、取消即移除、保存 AI 新用例需人工操作。

- [x] **Step 3: 更新未发布变更记录**

在 `CHANGELOG.md` 记录本次页面交互收敛和重复范围明细移除。

### Task 4: 全量验证

**Files:**
- No additional files.

- [x] **Step 1: 运行 Web 全量测试**

Run: `pnpm --filter flowx-web test --run`

Expected: 60 个测试文件、原有及新增测试全部通过。

- [x] **Step 2: 运行 Web build**

Run: `pnpm --filter flowx-web build`

Expected: TypeScript 编译和 Vite 构建成功。

- [x] **Step 3: 检查差异与文档镜像**

Run: `git diff --check && cmp -s docs/user-manual.md apps/web/public/user-manual.md`

Expected: 命令退出码为 0。

