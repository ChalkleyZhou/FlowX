# `@flowx-ai/local` Agent Guide

本文件适用于 `packages/flowx-local`。同时遵守仓库根目录 `AGENTS.md`；根规则与本文件冲突时，以本文件对本地 Agent 的具体规则为准。

## 包职责

`@flowx-ai/local` 是 FlowX Edge Agent 的本机 CLI 和 loopback daemon，负责：

- `flowx-local serve`：启动仅监听 `127.0.0.1` 的本地服务。
- `flowx-local mcp`：通过 stdio 启动内置 FlowX MCP。
- 本地仓库 URL 映射、IDE/OpenDesign 启动和项目 Skill/MCP 配置。
- 设备身份、短期会话、Outbox 重试和完成报告回传。
- `ToolAdapter` 扩展以及本地 Git 状态采集。

`flowx-local` 是端侧薄桥接层，不复制 FlowX 工作流状态机，也不把长期登录态写入项目目录或 Outbox。

## 目录边界

- `src/index.ts`：CLI 命令分发和进程入口。
- `src/server.ts`：loopback HTTP 服务和本地路由。
- `src/launch.ts`、`src/open-ide.ts`、`src/repo-map.ts`：本地执行启动、IDE 打开和仓库映射。
- `src/open-design.ts`、`src/adapters`：OpenDesign 和其他端侧工具 Adapter。
- `src/mcp.ts`：内置 MCP server、tool schema 和 API 桥接。
- `src/device.ts`、`src/config.ts`、`src/outbox.ts`：设备配置、身份和可靠回传。
- `templates/`：随 npm 包发布的 Skill 模板。

## 常用命令

```bash
pnpm --filter @flowx-ai/local build
pnpm --filter @flowx-ai/local test
pnpm flowx-local serve
pnpm flowx-local mcp
```

发布包使用 Node `>=20`。修改 CLI 入口、依赖或 `templates/` 后，至少运行 package build 和相关测试。

## 开发规范与安全边界

- 本地服务只绑定 loopback，不得默认改为 `0.0.0.0` 或暴露到局域网。
- ticket、短期 token 和 API 凭据不得写入日志、Outbox payload 或提交到仓库。
- Outbox 事件必须保持可重试和幂等；修改 payload 或 `idempotencyKey` 时同步检查 API 契约。
- MCP 保持薄桥接：状态以 FlowX API 为准，不在本地复制工作流状态判断。
- 修改项目 `.cursor/mcp.json`、Skill 或 prompt 文件时，保留用户已有配置和非 FlowX server，不覆盖无关内容。
- 不修改 `dist/`、本地 `~/.flowx` 运行数据或用户仓库中与当前任务无关的文件。
- `@flowx-ai/protocol` 是共享契约；修改其类型后先检查本包、API 和其他消费者。

## 测试与文档

- 修改任意源代码后运行 `pnpm --filter @flowx-ai/local test`；修改构建入口、依赖或模板后再运行 build。
- 修改 MCP tool schema、CLI 命令、loopback API、配置格式、安装方式或本地执行流程时，更新相关测试和根 `README.md`、`docs/local-agent-guide.md`、`docs/edge-agent-operations.md`、`docs/web-local-ide-launch.md` 或 `docs/user-manual.md`。
- 手册源文件发生变化时，同步更新 `apps/web/public` 镜像并执行根规则中的 `cmp` 校验。
- 交付前检查 `git diff --check`；跨包或跨 API/Web 契约变更时运行根目录 `pnpm check`。
