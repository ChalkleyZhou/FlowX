# WorkItem Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 以 WorkItem 为唯一业务根，完成需求/Issue、工作流、执行项、版本工作台和端云协同的最终模型迁移。

**Architecture:** 直接将 Requirement/Issue 迁移为统一 WorkItem 表；WorkflowRun 绑定 WorkItem，ExecutionPlan/ExecutionItem 负责拆解和派发，ExecutionSession 负责端侧执行。版本工作台服务端游标分页 WorkItem，不做投影或双写兼容。

**Tech Stack:** Prisma/SQLite、NestJS、React/Vite、TypeScript、`@flowx-ai/protocol`、FlowX MCP。

---

### Task 1: 固化数据模型和迁移

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261112090000_work_item_core/migration.sql`
- Test: `apps/api/src/work-items/work-item-schema.spec.ts`

- [x] 在 schema 中新增统一 `WorkItem`、`ExecutionPlan`、`ExecutionItem`，把 `WorkflowRun` 改为 `workItemId`，给 `ExecutionSession` 增加 `executionItemId`。
- [x] 为版本工作台添加 `(projectId, versionId, updatedAt, id)` 索引，为领取和完成添加执行项状态索引。
- [x] 编写事务迁移：复制旧数据到新表、迁移所有外键、校验数量、删除旧模型和旧字段；迁移脚本不得创建兼容视图或双写触发器。
- [x] 添加 schema 契约测试，断言旧模型和 `WorkflowRun.requirementId` 不存在，新模型及外键存在。
- [x] 运行 `pnpm prisma:generate` 和 `pnpm --filter flowx-api test -- work-item-schema`。

### Task 2: 后端 WorkItem 服务与版本工作台 API

**Files:**
- Create: `apps/api/src/work-items/work-items.module.ts`
- Create: `apps/api/src/work-items/work-items.controller.ts`
- Create: `apps/api/src/work-items/work-items.service.ts`
- Create: `apps/api/src/work-items/dto/*.dto.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/work-items/*.spec.ts`

- [x] 实现组织/工作区/项目/版本权限校验、稳定游标分页、`kind/status/ownerId/q` 筛选。
- [x] 实现快速创建、行内更新、详情聚合；创建时根据 `splitMode` 生成单执行项或 AI 拆解草案。
- [x] 为状态、负责人、备注更新补并发版本校验；审计事件沿用现有事件模型，后续单独建设。
- [x] 覆盖空版本、跨项目版本、无权限、游标重复、重复创建幂等和删除保护测试。

### Task 3: 工作流根迁移

**Files:**
- Modify: `apps/api/src/workflow/*.ts`
- Modify: `apps/api/src/requirements/*.ts`
- Modify: `apps/api/src/review-artifacts/*.ts`
- Modify: `apps/api/src/schedule/*.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: 受影响 workflow、review、schedule spec

- [x] 将所有 `workflow.requirement` 查询和上下文改为 `workflow.workItem`，按 `WorkItem.kind` 使用需求或 Issue 字段。
- [x] 启动、暂停、重启、代码交付、审查转 Issue/Bug、测试关联和 Bug 修复工作流全部使用 `workItemId`。
- [x] 排期继续只作用于 `kind=REQUIREMENT` 的 WorkItem，并从 WorkItem 详情独立读取。
- [x] 更新权限、删除和失败回滚测试。

### Task 4: 执行计划和执行项生命周期

**Files:**
- Create: `apps/api/src/execution-items/*`
- Modify: `apps/api/src/execution-sessions/*`
- Modify: `apps/api/src/workflow/*`
- Test: `apps/api/src/execution-items/*.spec.ts`

- [x] 实现 AI 拆解建议、人工确认、派发、领取、阻塞、完成、取消和合并提测门禁。
- [x] 简单 WorkItem 自动生成隐式 ExecutionItem；并行执行只有全部必需项完成才允许进入提测。
- [x] 使用事务条件更新和幂等键保护领取/完成；补充并发领取和重复回传测试。

### Task 5: Web 版本工作台

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/api.ts`
- Create: `apps/web/src/pages/VersionWorkItemsPage.tsx`
- Modify: `apps/web/src/App.tsx` 或路由文件
- Test: `apps/web/src/*.test.tsx`

- [x] 新增版本工作台表格，服务端游标分页，支持 Requirement/Issue 类型筛选。
- [x] 默认显示标题、类型、状态、负责人、备注、更新时间；行内编辑只开放高频字段。
- [x] 快速创建按钮默认带项目和版本，输入文案即可创建；改版本、启动工作流、拆解执行项放在详情/更多菜单。
- [x] 增加加载、空状态、错误、重复提交和分页尾页测试。

### Task 6: 本地协议与 MCP

**Files:**
- Modify: `packages/flowx-protocol/src/index.ts`
- Create: `packages/flowx-protocol/src/work-items.ts`
- Modify: `packages/flowx-local/src/mcp.ts`
- Modify: `docs/local-agent-guide.md`
- Modify: `apps/web/public/local-agent-guide.md`
- Test: protocol and local MCP tests

- [x] 增加 WorkItem/ExecutionItem 引用、领取、完成回传和证据事件 schema。
- [x] MCP 只做 API 薄桥接，暴露版本工作项查询、执行项领取、完成回传、阻塞和取消；不在本地复制拆解和权限规则。
- [x] 覆盖 schema、HTTP 映射、幂等错误和权限错误。

### Task 7: 文档和全链路验证

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/system-design.md`
- Modify: `docs/architecture/ai-maintainability.md`
- Modify: `docs/architecture/edge-cloud-ai-rd-platform.md`
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`

- [x] 更新数据模型、版本工作台、人机协同、执行项领取和迁移说明。
- [x] 校验用户手册镜像一致。
- [x] 运行 API/Web/local/protocol test/build 和 `pnpm check`；并行 Git 集成套件曾因资源争用超时，已用单 worker 串行重跑 19 个相关测试全部通过。
