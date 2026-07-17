# FlowX Agent Guide

## 项目概览

FlowX 是一个 AI 研发流程编排 MVP，用于把需求、AI 头脑风暴、技术方案、执行、审查和人工确认串成可追踪的工作流。

- Monorepo 包管理：`pnpm` workspace。
- 后端：`apps/api`，NestJS + TypeScript + Prisma + SQLite，负责认证、工作区/仓库、需求、工作流、AI 执行器、审查沉淀、排期、项目简报、每日 Code Review 和部署集成。
- 前端：`apps/web`，React + Vite + Tailwind + Radix/shadcn 风格组件，负责管理控制台、工作流详情、项目简报、Code Review、投递目标和排期视图。
- 数据层：`prisma/schema.prisma` 和 `prisma/migrations`。
- AI 集成：`apps/api/src/ai` 中的 Codex、Cursor、Mock executor 抽象与提示词/输出 schema。

## 指令层级

- 根目录 `AGENTS.md` 适用于整个仓库。
- `apps/api/AGENTS.md` 适用于后端子项目，修改 `apps/api` 下文件时必须同时遵守。
- `apps/web/AGENTS.md` 适用于前端子项目，修改 `apps/web` 下文件时必须同时遵守。
- 子项目 `AGENTS.md` 可以补充更具体规则；如与根目录规则冲突，以更具体、距离文件更近的规则为准。

## 常用命令

在仓库根目录执行：

```bash
pnpm install
pnpm dev
pnpm dev:api
pnpm dev:web
pnpm build
pnpm test
pnpm check
pnpm prisma:generate
pnpm prisma:migrate
pnpm db:clean
pnpm db:backfill-admins
```

常用子项目命令：

```bash
pnpm --filter flowx-api build
pnpm --filter flowx-api test
pnpm --filter flowx-web build
pnpm --filter flowx-web test
```

本地数据库初始化通常需要：

```bash
pnpm prisma:generate
pnpm --filter flowx-api exec prisma db push --schema ../../prisma/schema.prisma
```

## 目录结构

- `apps/api/src/main.ts`：NestJS API 入口。
- `apps/api/src/app.module.ts`：后端模块聚合。
- `apps/api/src/auth`：登录、会话、第三方认证、AI 凭据。
- `apps/api/src/ai`：AIExecutor 抽象、Codex/Cursor/Mock executor、AI 输出 schema。
- `apps/api/src/prompts`：任务拆解、技术方案、执行、审查、头脑风暴、设计生成等提示词和 schema contract。
- `apps/api/src/requirements`：需求与 ideation 编排，属于高风险区域。
- `apps/api/src/workflow`：工作流阶段推进、人工确认和审查编排，属于高风险区域。
- `apps/api/src/common`：共享类型、枚举、状态机和 demo 路由集成工具。
- `apps/api/src/workspaces`：工作区、代码仓库登记与同步。
- `apps/api/src/deploy`：部署集成 provider 抽象与实现。
- `apps/api/src/dev-preview`：本地预览命令探测和预览服务。
- `apps/api/src/briefings`：项目简报、代码事件聚合、AI 总结、简报定时生成和投递目标（投递目标按 `forBriefing` / `forCodeReview` 用途区分，供简报和 Code Review 共用）。
- `apps/api/src/daily-code-review`：独立的每日 Code Review 模块（配置、调度、数据源、skill 发现和渲染），与 `apps/api/src/briefings` 解耦，只复用其共享的投递目标与提交/时间窗口工具。
- `apps/api/src/schedule`：需求/项目排期与甘特图数据。
- `apps/api/src/notifications`：DingTalk 等通知发送集成。
- `apps/api/src/review-artifacts`：ReviewFinding、Issue、Bug 转换与维护。
- `apps/web/src/App.tsx`：前端路由入口。
- `apps/web/src/api.ts`：前端 API 边界，改动需谨慎并补测。
- `apps/web/src/pages`：页面级视图。
- `apps/web/src/components`：业务组件与基础 UI 组件。
- `apps/web/src/types.ts`：前端共享类型。
- `docs/architecture/ai-maintainability.md`：AI 可维护性指南。
- `docs/frontend-shadcn-design-spec.md`：前端布局与 shadcn 风格设计规范。
- `docs/user-manual.md`：用户手册内容来源。
- `prisma`：Prisma schema 与迁移。
- `docs`：系统设计、部署和架构文档。
- `.flowx-data`：本地运行数据，通常不要提交或手动改动。

## 代码规范

- 使用 TypeScript strict 配置；保持类型明确，避免用 `any` 绕过核心边界。
- 后端遵循 NestJS 模块组织：`*.module.ts` 聚合依赖，`*.controller.ts` 暴露 API，`*.service.ts` 放业务逻辑，DTO 放在 `dto/`。
- 前端优先复用 `apps/web/src/components/ui` 和现有业务组件，样式使用 Tailwind class 与 `cn` 工具。
- API 边界类型要保持前后端一致；改 Prisma schema、后端返回结构或 `apps/web/src/api.ts` 时，同步检查调用方和测试。
- AI 输出 schema、prompt contract 和解析/校验逻辑要保持单一事实来源，改 schema 时同步更新 contract/spec。
- 不手动编辑生成的 Prisma client 产物。
- 保持 diff 小而聚焦；不要把格式化、重命名、无关重构混入功能改动。
- 不提交密钥、token、个人登录态、本地数据库或 `.flowx-data` 运行数据。

## 测试和构建

- 全量构建：`pnpm build`。
- 全量测试：`pnpm test`。
- 交付前总检查：`pnpm check`，等价于先构建再测试。
- API 测试：`pnpm --filter flowx-api test`，Vitest node 环境，匹配 `apps/api/src/**/*.spec.ts`。
- Web 测试：`pnpm --filter flowx-web test`，Vitest 配置匹配 `apps/web/src/**/*.test.ts` 和 `apps/web/src/**/*.test.tsx`。
- Web 构建：`pnpm --filter flowx-web build`，执行 `tsc -b` 和 `vite build`。
- API 构建：`pnpm --filter flowx-api build`，执行 TypeScript 编译并复制 AI schema。

## 提交前检查

提交或交付前至少执行：

```bash
pnpm check
```

按改动范围补充执行：

- 修改 `apps/api/src/workflow`、`apps/api/src/common/workflow-state-machine.ts` 或 `apps/api/src/requirements/requirements.service.ts`：运行 `pnpm --filter flowx-api test`。
- 修改 `apps/web/src/api.ts` 或页面数据加载行为：运行 `pnpm --filter flowx-web test`。
- 修改 `prisma/schema.prisma`：运行 `pnpm prisma:generate`，必要时创建/更新 migration，并确认 API 构建和相关测试通过。
- 修改 Docker、部署或环境变量行为：同步更新 README 或 `docs` 中对应说明。

## AI 修改代码注意事项

- 不要改业务代码，除非用户明确要求；文档类任务只改文档。
- 开始前检查 `git status --short`，识别用户已有改动；不要回滚、覆盖或格式化无关文件。
- 修改子项目文件前，先读取对应子项目的 `AGENTS.md`。
- 优先读现有实现、测试和 README，再做最小改动。
- 修改工作流编排、ideation 编排、状态机、Prisma schema、认证、凭据、AI executor、项目简报/每日 Code Review/投递、排期或 API 边界时，把它们视为高风险区域：先补或更新测试，再改实现。
- 变更 `apps/api/src/workflow`、`apps/api/src/common/workflow-state-machine.ts`、`apps/api/src/requirements/requirements.service.ts` 前，优先添加或更新相关测试。
- 变更 `apps/api/src/briefings`、`apps/api/src/daily-code-review` 或 `apps/api/src/schedule` 前，优先添加或更新相关 API 测试。
- 变更 `apps/web/src/api.ts`、页面数据加载或关键交互时，优先添加或更新 Web 测试。
- 不要手动编辑 Prisma 生成物；schema 变更通过 Prisma 命令生成客户端和迁移。
- 保持一个分支聚焦一个子系统，除非任务明确跨多个子系统。
- 如果无法运行必要检查，要在交付说明中明确说明原因和剩余风险。
