# 项目永久删除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为项目增加仅主管理员可用的永久删除能力，并在存在执行中工作流或本地会话时安全拒绝删除。

**Architecture:** 在 `ProjectsService` 中以组织作用域查询项目、检查活动执行并在单事务内解除非级联外键后删除项目；Controller 负责读取会话角色并返回 API 结果。Web 通过 `api.deleteProject` 和复用确认弹窗模式在项目池与项目设置提供管理员入口，删除成功后清理当前项目上下文。

**Tech Stack:** NestJS、Prisma、SQLite、React、TypeScript、Vitest、Tailwind/shadcn UI。

---

### Task 1: 后端删除契约与权限测试

**Files:**
- Create: `apps/api/src/projects/project-delete.spec.ts`
- Modify: `apps/api/src/projects/projects.controller.ts`
- Modify: `apps/api/src/projects/projects.service.ts`

- [ ] **Step 1: 写失败测试**：在集成测试中从空 schema 建库，创建两个组织、工作区、项目、版本、工作项、已完成工作流和标签；断言 `admin` 删除成功后目标项目及版本/工作项/工作流/标签消失，其他项目保留；追加 `member`、`sub_admin`、活动 `StageExecution`、活动 `ExecutionSession`、不存在项目五个拒绝场景。
- [ ] **Step 2: 运行失败测试**：执行 `pnpm --filter flowx-api exec vitest run src/projects/project-delete.spec.ts`，确认当前缺少 `DELETE /projects/:id`/Service 方法而失败。
- [ ] **Step 3: 实现 Controller 契约**：给 `DELETE ':id'` 增加 `@Req()`，仅当 `req.authSession.organization.role === 'admin'` 时调用 Service；否则抛出 `ForbiddenException('只有主组织管理员可以删除项目。')`。
- [ ] **Step 4: 实现 Service 删除事务**：新增 `remove(id)`，先通过 `findUnique` 组织作用域读取项目；在事务中检查项目工作项下 `StageExecution.status = RUNNING` 和 `ExecutionSession.status in ACTIVE_EXECUTION_SESSION_STATUSES`，命中时抛出 `ConflictException('项目存在执行中的工作流或本地任务，请先完成或取消后再删除。')`。将当前版本引用置空，删除项目版本上的 `TestDesign`/`TestRequest` 关联记录及其连接表、项目简报/代码审查及投递日志、项目缺陷的 `projectId`、非级联直接记录，然后删除项目；返回 `{ success: true, projectId: id }`。
- [ ] **Step 5: 运行绿色测试**：再次执行同一 Vitest 命令，确认权限、活动保护、成功清理和 404 全部通过。

### Task 2: API 客户端和项目池删除交互

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/pages/ProjectsPage.tsx`
- Modify: `apps/web/src/pages/ProjectsPage.test.tsx`（若现有测试文件不存在则创建）

- [ ] **Step 1: 写失败测试**：增加 `deleteProject` 请求路径/方法断言；增加管理员看到“删除项目”、输入名称不匹配时按钮禁用、匹配后调用删除并刷新列表的页面测试；普通成员不渲染删除入口。
- [ ] **Step 2: 运行失败测试**：执行 `pnpm --filter flowx-web exec vitest run src/api.test.ts src/pages/ProjectsPage.test.tsx`，确认 helper 和入口尚不存在。
- [ ] **Step 3: 实现 API helper**：在 `api` 对象中新增 `deleteProject(projectId: string) => request<{ success: true; projectId: string }>(`/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' })`。
- [ ] **Step 4: 实现项目池弹窗**：使用 `useAuth()` 判断 `session?.organization?.role === 'admin'`；为卡片增加危险操作按钮和 Dialog，展示项目名、工作项数量、不可恢复提示，要求输入完全匹配项目名；提交期间禁用按钮，错误显示服务端消息，成功后刷新列表并清除当前项目作用域（若正在查看该项目则导航 `/projects`）。
- [ ] **Step 5: 运行绿色测试**：再次执行页面和 API 测试，确认管理员、普通成员、输入校验、成功刷新和错误展示通过。

### Task 3: 项目设置删除入口与当前项目清理

**Files:**
- Modify: `apps/web/src/pages/ProjectDetailPage.tsx`
- Modify: `apps/web/src/pages/ProjectDetailPage.test.tsx`

- [ ] **Step 1: 写失败测试**：管理员在项目设置标题操作区看到删除入口；普通成员看不到；名称确认后调用 `api.deleteProject` 并跳转 `/projects`，409 错误保留弹窗并展示提示。
- [ ] **Step 2: 运行失败测试**：执行 `pnpm --filter flowx-web exec vitest run src/pages/ProjectDetailPage.test.tsx`，确认入口和调用不存在。
- [ ] **Step 3: 实现详情页入口**：复用项目池确认弹窗的交互结构或抽出 `ProjectDeleteDialog` 组件；在标题 actions 中仅对 `admin` 显示；成功后调用 scope 的清理能力并 `navigate('/projects')`。
- [ ] **Step 4: 运行绿色测试**：执行详情页测试并确认成功跳转、非管理员隐藏、409 展示均通过。

### Task 4: 文档、镜像与回归验证

**Files:**
- Modify: `README.md`
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 更新文档**：在项目管理说明中写明删除入口位于项目池和项目设置，仅主管理员可用；删除永久清理项目业务数据；执行中工作流或本地会话存在时必须先完成或取消。
- [ ] **Step 2: 校验手册镜像**：执行 `cp docs/user-manual.md apps/web/public/user-manual.md` 后运行 `cmp -s docs/user-manual.md apps/web/public/user-manual.md`。
- [ ] **Step 3: 运行受影响检查**：执行 `pnpm --filter flowx-api test`、`pnpm --filter flowx-web test`、`pnpm --filter flowx-api build`、`pnpm --filter flowx-web build` 和 `git diff --check`。
- [ ] **Step 4: 检查变更范围**：执行 `git status --short` 与 `git diff --stat`，确认不包含用户已有修改、生成物、数据库或 `.flowx-data`。
