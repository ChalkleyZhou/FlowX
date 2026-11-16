# 工作项可读编号 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为需求、问题、缺陷增加项目内按类型递增的可读编号，并在工作项相关页面展示该编号，同时保留真实 `id` 用于 API 和路由。

**Architecture:** 在 `WorkItem` 增加可空 `displayCode`，用 `WorkItemSequence(projectId, kind)` 在事务中分配序号；迁移时按项目、类型、创建时间回填历史数据。API 直接返回字段，前端列表、详情和引用组件优先展示 `displayCode`，缺失时回退真实 `id` 兼容旧数据。

**Tech Stack:** Prisma/SQLite、NestJS、React、TypeScript、Vitest。

---

### Task 1: 数据模型与历史回填

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261116150000_add_work_item_display_code/migration.sql`
- Modify: `apps/api/src/work-items/work-item-schema.spec.ts`

- [ ] 增加 `WorkItem.displayCode` 和 `WorkItemSequence`，加入项目/类型唯一约束。
- [ ] 编写 SQLite 迁移，按 `projectId/kind/createdAt/id` 为历史工作项生成 `REQ-001`、`ISSUE-001`、`BUG-001`，同步初始化序列表。
- [ ] 更新 schema 断言并运行该 spec。

### Task 2: 统一编号分配服务

**Files:**
- Create: `apps/api/src/work-items/work-item-identifier.service.ts`
- Modify: `apps/api/src/work-items/work-items.module.ts`
- Modify: `apps/api/src/work-items/work-items.service.ts`
- Modify: `apps/api/src/requirements/requirements.service.ts`
- Modify: `apps/api/src/prototype-imports/prototype-imports.service.ts`
- Modify: `apps/api/src/review-artifacts/review-artifacts.service.ts`
- Modify: `apps/api/src/workflow/workflow.service.ts`
- Test: `apps/api/src/work-items/work-item-identifier.service.spec.ts`

- [ ] 在事务内通过 `WorkItemSequence` 原子递增并生成类型前缀编号。
- [ ] 接入标准需求、版本工作项、原型导入、审查转换和缺陷修复等创建路径。
- [ ] 测试三种前缀、项目隔离和连续递增。

### Task 3: API 与前端展示

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/components/RequirementListTable.tsx`
- Modify: `apps/web/src/pages/VersionWorkItemsPage.tsx`
- Modify: `apps/web/src/pages/WorkItemDetailPage.tsx`
- Modify: `apps/web/src/pages/RequirementDetailPage.tsx`
- Modify: `apps/web/src/pages/IssuesPage.tsx`
- Modify: `apps/web/src/pages/BugsPage.tsx`

- [ ] 为工作项类型补充 `displayCode`，引用类型同步携带。
- [ ] 工作项列表、版本工作台和详情页展示可读编号，路由仍使用 `id`。
- [ ] 编号缺失时回退显示 `id`，避免历史接口数据导致空白。

### Task 4: 文档与验证

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`

- [ ] 记录编号规则和兼容行为。
- [ ] 运行 Prisma generate、API test/build、Web test/build、`git diff --check` 和手册镜像校验。
- [ ] 提交并推送中文 Git commit。
