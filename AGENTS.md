# FlowX Agent Guide

## 语言规范

- 默认使用简体中文与用户交流，包括工作进度、问题说明、代码审查意见和最终答复。
- 默认使用简体中文编写或更新 README、设计文档、需求规格、实施计划、测试计划、运维文档、发布说明和变更日志。
- 代码标识符、类型名、函数名、文件路径、命令、配置键、环境变量、接口路径、HTTP 字段、错误码和协议名称保持原始英文。
- 代码注释默认使用简体中文；如果目标文件已有明确的英文注释规范，遵循文件和子项目现有风格。
- 用户、项目级 `AGENTS.md` 或 `CLAUDE.md` 有更具体的语言要求时，遵循更具体的规则。

## 适用范围与优先级

- 本文件适用于整个仓库。
- 修改 `apps/api` 下文件时，必须同时遵守 `apps/api/AGENTS.md`。
- 修改 `apps/web` 下文件时，必须同时遵守 `apps/web/AGENTS.md`。
- 更深层目录中的规则可以补充本文件；规则冲突时，以距离目标文件更近的规则为准。
- 用户当前任务和更高优先级系统/开发者指令优先于本文件。

## 项目概览

FlowX 是一个 AI 研发流程编排 MVP，正在演进为端云协同 AI 产研平台，用于把需求、AI 头脑风暴、技术方案、执行、审查和人工确认串成可追踪的工作流。

- Monorepo：`pnpm` workspace。
- 后端：`apps/api`，NestJS + TypeScript + Prisma + SQLite。
- 前端：`apps/web`，React + Vite + Tailwind + Radix/shadcn 风格组件。
- 数据层：`prisma/schema.prisma` 和 `prisma/migrations`。
- 本地端侧包：`packages/flowx-local`（`@flowx-ai/local`）、`packages/flowx-mcp` 和 `packages/flowx-protocol`。
- AI 集成：`apps/api/src/ai` 中的 Codex、Cursor、Mock executor，以及本地 MCP/Edge Agent。

## 目录与边界

- `apps/api/src/workflow`：工作流阶段推进、人工确认和审查编排，高风险区域。
- `apps/api/src/requirements`：需求、ideation、设计生成和会话恢复，高风险区域。
- `apps/api/src/common`：共享类型、枚举、状态机和路由集成工具。
- `apps/api/src/briefings`：项目简报、事件聚合、AI 总结、定时生成和投递目标。
- `apps/api/src/daily-code-review`：独立的每日 Code Review 模块和 sandbox 数据源。
- `apps/api/src/schedule`：需求/项目排期与甘特图数据。
- `apps/api/src/auth`、`apps/api/src/ai`、`prisma/schema.prisma`：认证凭据、AI executor 和数据契约，高风险区域。
- `apps/web/src/api.ts`：前端 API 边界，高风险区域。
- `apps/web/src/pages`、`apps/web/src/components`：页面和业务组件。
- `apps/web/src/components/ui`：基础 UI 组件；优先复用，不重复实现。
- `packages/flowx-local`：本地 loopback daemon、CLI、IDE 启动、Skill/MCP 配置和本地回传。
- `packages/flowx-mcp`：兼容的独立 MCP server。
- `packages/flowx-protocol`：端云共享协议类型、常量和 schema。
- `docs`：系统设计、架构、部署、运维和用户文档。
- `docs/user-manual.md`：用户手册源文件。
- `docs/local-agent-guide.md`：本地 Agent 用户指南源文件。
- `apps/web/public/user-manual.md`、`apps/web/public/local-agent-guide.md`：Web 内嵌手册镜像。
- `.flowx-data`：本地运行数据，通常不要提交或手动修改。每日 Code Review sandbox 位于 `.flowx-data/code-review/workspaces/{workspaceId}/repositories/{slug}-{id8}`，可用 `CODE_REVIEW_REPOS_ROOT` 覆盖根目录。

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

按子项目执行：

```bash
pnpm --filter flowx-api build
pnpm --filter flowx-api test
pnpm --filter flowx-web build
pnpm --filter flowx-web test
pnpm --filter @flowx-ai/local build
pnpm --filter @flowx-ai/local test
pnpm --filter flowx-mcp build
pnpm --filter flowx-mcp test
pnpm --filter @flowx-ai/protocol build
pnpm --filter @flowx-ai/protocol test
```

本地数据库初始化通常需要：

```bash
pnpm prisma:generate
pnpm --filter flowx-api exec prisma db push --schema ../../prisma/schema.prisma
```

## 开发规范

- 使用 TypeScript strict 配置，保持类型明确；不要用 `any` 绕过核心边界。
- 后端遵循 NestJS 模块组织：Controller 负责 HTTP 协调，Service 负责业务逻辑，DTO 放在对应模块的 `dto/` 下。
- 前端优先复用现有页面布局、业务组件、`components/ui` 和 `cn`；API 请求集中通过 `apps/web/src/api.ts`。
- API 返回、前端类型、页面调用方和测试必须保持一致；改 API 边界时同步检查全链路。
- Prisma schema、AI 输出 schema、prompt contract、解析器和测试保持单一事实来源；修改契约时一起更新消费者和 contract/spec。
- 状态流转通过现有状态机或编排服务表达，不在多个位置复制状态判断。
- 保持 diff 小而聚焦，不混入无关格式化、重命名或重构。
- 不手动编辑 `dist/`、生成的 Prisma client 或其他生成物。

## 工作流程与安全边界

- 开始前运行 `git status --short`，识别并保留用户已有修改。
- 修改子项目文件前，先读取对应子项目的 `AGENTS.md`、相关实现、测试和 README/专题文档。
- 高风险区域先补充或更新测试，再修改实现；至少覆盖状态转换、API 契约、权限、凭据和失败路径。
- 不回滚、覆盖、格式化或删除与当前任务无关的用户修改。
- 不提交密钥、token、个人登录态、本地数据库、`.flowx-data` 或其他运行时数据。
- 不执行 `git reset --hard`、`git checkout --` 或宽范围删除；除非用户明确要求且目标已确认。
- 错误信息应便于 UI 和运维定位，但不得泄露 token、密钥、完整凭据或个人登录态。
- 变更应聚焦一个子系统；若跨越 API、Web、packages、Prisma 或文档边界，必须同步检查所有消费者。

## 文档与使用手册同步

- 任何用户可见的功能、页面交互、API、CLI 命令、配置键、环境变量、安装方式、部署行为或工作流状态变更，都要在同一变更中检查并更新对应文档。
- 面向终端用户的变更至少检查 `README.md`、`docs/user-manual.md` 和相关专题文档；平台内展示的手册还要同步 `apps/web/public` 对应镜像。
- 修改 API、数据模型、AI 输出、协议或架构时，同步检查 `docs/system-design.md`、`docs/architecture`、接口/专题说明和相关 spec/contract。
- 修改 Docker、部署或环境变量时，同步更新 `README.md`、`docs/docker-deployment.md` 或对应运维文档。
- `docs/user-manual.md` 和 `docs/local-agent-guide.md` 是源文件；交付前校验其与 `apps/web/public` 对应文件一致：

```bash
cmp -s docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
```

- 历史性的 `docs/superpowers/plans` 和 `docs/superpowers/specs` 默认不回写；只有当前任务改变设计基线或计划状态时才更新。

## 测试与交付

根据改动范围执行：

- 全仓代码改动：`pnpm check`。
- API 改动：`pnpm --filter flowx-api test`；修改 `prisma/schema.prisma` 时先运行 `pnpm prisma:generate`，必要时更新 migration。
- Web API 边界、页面数据加载、路由、认证或关键交互改动：`pnpm --filter flowx-web test`，必要时运行 Web build 和浏览器检查。
- `packages/flowx-local`、`packages/flowx-mcp` 或 `packages/flowx-protocol` 改动：运行对应 package 的 test；修改构建入口、依赖或协议时运行对应 build。
- 工作流、状态机、需求 ideation、认证凭据、AI executor、简报、每日 Code Review、投递、排期或 API 边界改动：优先更新相关测试，再运行受影响子项目测试。
- 纯文档或规则改动：至少运行 `git diff --check`；若涉及手册镜像，运行上面的 `cmp` 命令。
- 无法运行必要检查时，在交付说明中写明原因和剩余风险。

交付前确认：

1. 变更范围和用户已有修改均已核对。
2. 用户可见行为对应的 README、专题文档和使用手册已同步。
3. 必要测试、构建和文档一致性检查已完成，或已明确记录未执行项。
