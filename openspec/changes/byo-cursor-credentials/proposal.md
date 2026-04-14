## Why

当前 FlowX 在服务端以共享身份执行 Cursor CLI：要么使用全局 `CURSOR_API_KEY`，要么依赖容器内已登录状态。这会导致多用户场景下无法按用户隔离 AI 身份，审计粒度不足，且凭据风险面较大。现在需要支持“用户自带 Cursor 凭据（BYO）”并保持现有部署兼容。

## What Changes

- 新增用户级 Cursor 凭据管理能力，支持设置、更新、删除和状态查询。
- 新增服务端加密存储机制，仅保存密文，不回传明文。
- 工作流执行 Cursor provider 时优先使用发起用户凭据，兼容回退全局 `CURSOR_API_KEY` 与 CLI 登录态。
- 增加凭据相关安全与审计事件，统一错误语义，避免敏感信息泄漏到日志。
- 更新部署文档，明确兼容模式与灰度切换策略。

## Capabilities

### New Capabilities
- `user-cursor-credentials`: 定义用户级 Cursor API Key 的加密存储、访问控制、执行注入与回退行为。

### Modified Capabilities
- 无。

## Impact

- 后端：`apps/api` 的 `workflow`、`ai`、`auth`、新凭据模块与 Prisma 数据模型。
- 前端：`apps/web` 的 API 客户端与设置入口页面。
- 数据库：`prisma/schema.prisma` 新增用户凭据表。
- 部署与运维：`.env` 变量说明、Docker 部署文档、回退策略说明。
