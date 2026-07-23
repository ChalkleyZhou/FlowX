# `flowx-mcp` Agent Guide

本文件适用于 `packages/flowx-mcp`。同时遵守仓库根目录 `AGENTS.md`；根规则与本文件冲突时，以本文件对 MCP server 的具体规则为准。

## 包职责

`flowx-mcp` 是独立、私有的 FlowX MCP server，提供 Cursor/其他 Agent 使用的薄工具桥接：

- 读取本地活跃设计会话和版本化 handoff。
- 调用 FlowX API 获取任务上下文、提交设计/头脑风暴/完成报告。
- 采集只读的本地 Git 状态。

MCP 不拥有 FlowX 业务状态，不复制工作流状态机，不绕过 API 鉴权，也不应在工具中实现与 API 重复的业务编排。当前新用户路径优先使用 `@flowx-ai/local` 的 `flowx-local mcp`；本包的兼容行为和文档仍需保持可用。

## 目录边界

- `src/index.ts`：stdio server 入口。
- `src/server.ts`：MCP server 注册和工具边界。
- `src/tools.ts`：工具 schema 与处理逻辑。
- `src/flowx-api-client.ts`：FlowX API 请求封装。
- `src/active-design-session.ts`：本地活跃设计会话读取。
- `src/git-report.ts`：只读 Git 状态采集。

## 常用命令

```bash
pnpm --filter flowx-mcp build
pnpm --filter flowx-mcp test
pnpm --filter flowx-mcp exec node dist/index.js
```

## 开发规范与安全边界

- MCP 使用 stdio 通信；stdout 只能输出 MCP 协议内容，诊断信息不得污染 stdout。
- 不在日志、错误响应或测试 fixture 中泄露 token、密钥、完整凭据或个人登录态。
- API 请求、工具输入和输出必须保留明确的 schema 校验；错误应返回可识别的 MCP error，不吞掉失败原因。
- Git report 默认只读，不修改工作区、分支、文件或远程仓库。
- 修改 API 路径、HTTP 字段、工具名或 schema 时，先检查 `apps/api`、`packages/flowx-local` 和前端调用方。
- 不修改 `dist/`、本地运行数据或用户仓库中的无关文件。

## 测试与文档

- 修改任意源代码后运行 `pnpm --filter flowx-mcp test`；修改构建入口或依赖后再运行 build。
- 修改工具、API 契约、MCP 配置或用户安装方式时，更新相关测试以及 `README.md`、MCP/本地 Agent 专题文档和用户手册。
- 协议或 API 变化必须同步检查 `packages/flowx-protocol`、`apps/api`、`apps/web` 及相关 spec/contract。
- 交付前检查 `git diff --check`；跨包变更时运行根目录 `pnpm check`。
