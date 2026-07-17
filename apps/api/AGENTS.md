# FlowX API Agent Guide

## 项目概览

`apps/api` 是 FlowX 的后端服务，基于 NestJS + TypeScript + Prisma + SQLite。它负责认证与会话、工作区和仓库管理、需求 ideation、工作流阶段编排、AI executor 调用、审查产物沉淀、项目排期、项目简报、每日 Code Review、本地预览和部署集成。

本子项目属于高风险核心区域，尤其是工作流编排、需求 ideation、AI 输出解析、认证凭据、Prisma 数据模型、项目简报/每日 Code Review/投递、排期和 API 边界。

## 常用命令

在仓库根目录执行：

```bash
pnpm --filter flowx-api build
pnpm --filter flowx-api test
pnpm --filter flowx-api dev
pnpm --filter flowx-api prisma:generate
pnpm --filter flowx-api prisma:migrate
```

也可以使用根命令：

```bash
pnpm build:api
pnpm dev:api
pnpm prisma:generate
pnpm prisma:migrate
pnpm check
```

本地数据库同步：

```bash
pnpm --filter flowx-api exec prisma db push --schema ../../prisma/schema.prisma
```

## 目录结构

- `src/main.ts`：NestJS 启动入口。
- `src/app.module.ts`：后端根模块。
- `src/auth`：账号密码登录、DingTalk 登录、会话 guard、AI 凭据管理和加密。
- `src/ai`：AIExecutor 抽象，Codex/Cursor/Mock executor，AI 输出 JSON schema 和校验。
- `src/prompts`：AI 各阶段提示词，以及 schema contract 测试对应的 contract 生成逻辑。
- `src/requirements`：需求、头脑风暴、设计生成、demo 生成和 ideation 会话恢复，属于高风险区域。
- `src/workflow`：工作流阶段推进、人工确认、执行和审查编排，属于高风险区域。
- `src/common`：共享枚举、类型、状态机和 demo 路由集成工具。
- `src/workspaces`：工作区、仓库登记、仓库同步和分支元数据。
- `src/projects`：项目管理 API。
- `src/briefings`：项目简报来源、事件归档、AI 总结、简报定时生成、投递目标和投递日志，属于高风险区域。投递目标带 `forBriefing`/`forCodeReview` 用途标记，由简报和每日 Code Review 共用。
- `src/daily-code-review`：独立的 `DailyCodeReviewModule`——控制器、`ProjectCodeReviewConfig`、CR 调度、`CodeReviewSource` 数据源、review skill 磁盘发现（`review-skill-discovery.ts`）和渲染，属于高风险区域。只从 `src/briefings` 导入共享的投递目标服务与提交/时间窗口工具，不复用简报的调度或配置。
- `src/schedule`：需求/项目排期和甘特图数据，属于高风险区域。
- `src/review-artifacts`：ReviewFinding、Issue、Bug 的维护和转换。
- `src/deploy`：部署 provider 抽象和 provider 实现。
- `src/dev-preview`：本地开发预览命令探测和预览生命周期。
- `src/notifications`：DingTalk 通知服务。
- `src/prisma`：PrismaService 和 PrismaModule。
- `scripts`：构建期辅助脚本，例如复制 AI schema。

## 代码规范

- 遵循 NestJS 模块边界：Controller 只做 HTTP 入参/出参协调，业务逻辑放 Service，跨模块依赖通过 Module imports/exports 暴露。
- DTO 放在对应模块的 `dto/` 下，优先使用 `class-validator`/`class-transformer` 表达输入约束。
- 数据访问优先集中在 Service 中通过 `PrismaService` 完成；不要在无关模块散落复杂 Prisma 查询。
- Prisma schema 是数据契约源头；不要手动编辑生成的 Prisma client。
- AI 输出 schema、prompt contract、解析器和测试要保持一致；改 schema 时同步更新 contract/spec 和 executor 兼容逻辑。
- 状态流转必须通过 `src/common/workflow-state-machine.ts` 或现有编排服务表达，不要在多个地方复制状态判断。
- 错误信息应便于 UI 和运维定位，但不要泄露 token、密钥、完整凭据或个人登录态。
- 保持 TypeScript strict 友好；只在测试 mock 或隔离边界中谨慎使用 `as any`。

## 测试和构建

- 构建：`pnpm --filter flowx-api build`。
- 测试：`pnpm --filter flowx-api test`。
- API 测试使用 Vitest node 环境，匹配 `src/**/*.spec.ts`。
- 修改 schema 后运行 `pnpm --filter flowx-api prisma:generate`，必要时更新 `prisma/migrations`。
- 交付前如改动影响整个仓库，运行根目录 `pnpm check`。

## 提交前检查

至少按改动范围执行：

- 后端任意代码改动：`pnpm --filter flowx-api test`。
- 修改 `src/workflow`：`pnpm --filter flowx-api test`。
- 修改 `src/common/workflow-state-machine.ts`：`pnpm --filter flowx-api test`。
- 修改 `src/requirements/requirements.service.ts` 或 ideation 编排：`pnpm --filter flowx-api test`。
- 修改 `src/briefings`、`src/daily-code-review`、投递或通知发送：`pnpm --filter flowx-api test`。
- 修改 `src/schedule` 或排期相关 Prisma model/API：`pnpm --filter flowx-api test`。
- 修改 AI executor、prompt、schema 或 contract：运行相关 spec，并优先运行完整 `pnpm --filter flowx-api test`。
- 修改 Prisma schema：`pnpm --filter flowx-api prisma:generate`，再运行 API build/test。
- 最终交付前：`pnpm check`，如无法运行需说明原因。

## AI 修改代码注意事项

- 先读相关 Service、Controller、DTO、测试和 Prisma model，再做小范围修改。
- 优先添加或更新测试，再改工作流、ideation、状态机、AI 输出解析、认证凭据或数据模型。
- 不要改 `dist/`、生成的 Prisma client、运行时数据库或本地数据目录。
- 不要把 Mock executor、Codex executor、Cursor executor 的行为混在一次大改里，除非任务明确要求。
- 修改 API 返回结构时，同步检查 `apps/web/src/api.ts`、前端类型和页面调用方。
- 对高风险文件保持窄 diff：`prisma/schema.prisma`、`src/workflow`、`src/requirements`、`src/common/workflow-state-machine.ts`、`src/auth`、`src/ai`、`src/briefings`、`src/daily-code-review`、`src/schedule`。
- 遇到已有未提交改动时，默认视为用户工作；不要回滚，必要时围绕现有改动继续。
