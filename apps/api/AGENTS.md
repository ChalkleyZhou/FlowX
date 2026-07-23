# FlowX API Agent Guide

本文件适用于 `apps/api`。同时遵守仓库根目录 `AGENTS.md`；根规则与本文件冲突时，以本文件对后端的具体规则为准。

## 项目范围

`apps/api` 是 FlowX 的 NestJS + TypeScript + Prisma + SQLite 后端，负责认证与会话、工作区/仓库、需求 ideation、工作流编排、AI executor、审查沉淀、排期、项目简报、每日 Code Review、本地预览和部署集成。

以下区域属于高风险边界：

- `src/workflow`、`src/common/workflow-state-machine.ts`：状态流转、人工确认和执行/审查编排。
- `src/requirements`：需求、头脑风暴、设计生成、demo 生成和 ideation 会话恢复。
- `src/auth`、`src/ai`：认证凭据、加密、executor 和 AI 输出解析。
- `src/briefings`、`src/daily-code-review`、`src/schedule`：简报、每日 Code Review、投递和排期。
- `prisma/schema.prisma`：数据库与 API 数据契约。

每日 Code Review 必须使用独立 sandbox：
`.flowx-data/code-review/workspaces/{workspaceId}/repositories/{slug}-{id8}`，根目录可由 `CODE_REVIEW_REPOS_ROOT` 覆盖。不得调用面向主开发 clone 的同步流程，也不得写入 `Repository.localPath`。

## 常用命令

在仓库根目录执行：

```bash
pnpm --filter flowx-api dev
pnpm --filter flowx-api build
pnpm --filter flowx-api test
pnpm --filter flowx-api prisma:generate
pnpm --filter flowx-api prisma:migrate
pnpm --filter flowx-api exec prisma db push --schema ../../prisma/schema.prisma
```

等价根命令：

```bash
pnpm dev:api
pnpm build:api
pnpm prisma:generate
pnpm prisma:migrate
```

## 目录边界

- `src/main.ts`：NestJS 启动入口。
- `src/app.module.ts`：模块聚合和全局依赖。
- `src/*/*.controller.ts`：HTTP 入参/出参协调，不承载复杂业务逻辑。
- `src/*/*.service.ts`：业务编排和数据访问。
- `src/*/dto`：输入 DTO，优先使用 `class-validator` 和 `class-transformer`。
- `src/prisma`：`PrismaService` 和 Prisma 模块。
- `scripts`：构建期辅助脚本；不要把生成结果提交到 `dist/`。

## 后端开发规范

- 遵循 NestJS 模块边界；跨模块依赖通过 Module 的 imports/exports 暴露。
- 数据访问集中在 Service 中通过 `PrismaService` 完成，不在无关模块散落复杂查询。
- `prisma/schema.prisma` 是数据契约源头；不要手动编辑生成的 Prisma client。
- 状态流转必须通过 `src/common/workflow-state-machine.ts` 或现有编排服务表达，不复制状态判断。
- AI 输出 schema、prompt contract、解析器、executor 兼容逻辑和测试必须保持一致。
- 保持 TypeScript strict 友好；只在测试 mock 或隔离边界谨慎使用 `as any`。
- 错误信息便于 UI 和运维定位，但不得泄露 token、密钥、完整凭据或个人登录态。
- 修改 API 返回结构时，同步检查 `apps/web/src/api.ts`、`apps/web/src/types.ts` 和页面调用方。

## 测试与文档

- 后端代码改动至少运行 `pnpm --filter flowx-api test`。
- 修改工作流、状态机、需求 ideation、认证凭据、AI executor、简报、每日 Code Review、投递、排期或 API 边界时，先更新相关测试，再运行受影响 spec；必要时运行完整 API 测试。
- 修改 `prisma/schema.prisma`：运行 `pnpm --filter flowx-api prisma:generate`，必要时更新 migration，再运行 API build/test。
- API、数据模型、AI 输出或协议变更时，检查前端契约、`docs/system-design.md`、`docs/architecture` 和相关 spec/contract。
- 用户可见的 API、配置、工作流或安装行为变更时，同步检查根 `README.md`、`docs/user-manual.md` 和相关专题文档。
- 无法运行必要检查时，在交付说明中写明原因和剩余风险。

## 修改流程与边界

- 开始前检查 `git status --short`，把已有未提交改动视为用户工作；不要回滚、覆盖或格式化无关文件。
- 先读相关 Controller、Service、DTO、Prisma model、测试和文档，再做最小修改。
- 高风险改动保持窄 diff，优先补测试再改实现。
- 不修改 `dist/`、生成物、运行时数据库或 `.flowx-data`。
- 不把 Mock、Codex、Cursor executor 的行为混在一次无关的大改中。
- 交付前根据影响范围运行 API test/build；跨越整个仓库时运行根目录 `pnpm check`。
