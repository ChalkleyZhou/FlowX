# `@flowx-ai/protocol` Agent Guide

本文件适用于 `packages/flowx-protocol`。同时遵守仓库根目录 `AGENTS.md`；根规则与本文件冲突时，以本文件对共享协议包的具体规则为准。

## 包职责

`@flowx-ai/protocol` 是 FlowX API、Edge Agent、MCP 和其他端侧消费者共享的协议类型、常量和数据模型包。它只表达跨边界契约，不承载 HTTP 服务、数据库访问、文件写入或工作流业务编排。

## 目录边界

- `src/index.ts`：公开导出入口。
- `src/context-package.ts`：版本化上下文包。
- `src/execution-session.ts`：执行会话契约。
- `src/design.ts`、`src/brainstorm.ts`：设计和头脑风暴结果契约。
- `src/artifact.ts`、`src/sync-event.ts`：Artifact 与端云同步事件契约。
- `src/errors.ts`、`src/version.ts`：共享错误码和协议版本。
- `src/*.test.ts`：协议契约测试。

## 常用命令

```bash
pnpm --filter @flowx-ai/protocol build
pnpm --filter @flowx-ai/protocol test
```

该包要求 Node `>=20`，构建产物由 TypeScript 生成到 `dist/`，不得手动编辑或提交不必要的生成文件。

## 契约变更规范

- 修改公开类型、字段、枚举、错误码或协议版本时，先检查所有消费者：`apps/api`、`packages/flowx-local`、`packages/flowx-mcp` 和 `apps/web`。
- 优先采用向后兼容的增量字段；删除、改名、改变必填性或改变枚举语义前，必须明确处理旧消费者和迁移路径。
- 类型定义、运行时校验、API DTO、MCP schema、测试 fixture 和文档必须保持一致。
- 只有在协议语义确实变化时才更新 `src/version.ts`；普通实现修复不要随意升级协议版本。
- 不在协议包中加入业务状态判断、NestJS/Prisma 依赖或端侧运行时副作用。

## 测试与文档

- 修改任意协议源文件后运行 `pnpm --filter @flowx-ai/protocol test` 和 build。
- 修改协议后同步更新 API/Edge/MCP 消费者和相关 contract/spec；如果影响用户可见行为，更新根 `README.md`、专题文档和用户手册。
- 不手动编辑 `dist/` 或其他生成物；无法运行消费者测试时，在交付说明中明确剩余风险。
