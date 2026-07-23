# FlowX 本地 Agent 使用指南

本文档面向需要在本机安装并使用 `@flowx-ai/local` 的同学。本地 Agent 在你的电脑上运行，把 FlowX Web 与 Cursor / Codex / OpenDesign 安全地接在一起。

## 1. 这是什么

`flowx-local`（npm 包名 `@flowx-ai/local`）是 FlowX 的本机 Edge Agent：

- 只监听本机 loopback（默认 `http://127.0.0.1:3920`）
- 接收 Web 下发的一次性启动票据，兑换短期凭据
- 打开本地 IDE 或 OpenDesign，并写入执行/设计上下文
- 在网络不稳时把完成报告放入本地 Outbox，稍后重试回传

不需要把 FlowX 仓库克隆到本机才能使用。

## 2. 安装

使用公共 npm 安装（若本机默认公司源，请显式指定 registry）：

```bash
npm install -g @flowx-ai/local --registry https://registry.npmjs.org
```

安装完成后，终端应能直接运行 `flowx-local`。

不想全局安装时，可用：

```bash
npx @flowx-ai/local@latest serve
```

## 3. 启动

```bash
flowx-local serve
```

保持该终端窗口运行。可用下面命令确认健康状态：

```bash
flowx-local status
```

或：

```bash
curl http://127.0.0.1:3920/health
```

首次运行会在 `~/.flowx/local.json` 写入设备身份与端口等配置。

## 4. 在 FlowX 里怎么用

### 4.1 工作流「本地启动」

1. 打开一条进入开发执行阶段的工作流
2. 确认本机已运行 `flowx-local serve`
3. 点击「本地启动」，选择 Cursor 或 Codex
4. Agent 会匹配本地仓库路径（必要时提示映射）、写入 Skill/MCP，并打开 IDE

开发完成后，可用 IDE 内 MCP 回写完成报告，或在 Web 上使用「完成本地执行」。

### 4.2 OpenDesign 本地设计

1. 本机保持 `flowx-local serve`
2. 在需求或工作流相关入口点击打开本地 OpenDesign
3. 在 Open Design 中选择自己的项目目录并完成设计
4. 通过 FlowX MCP（推荐）或工作流「回传本地设计」把结果交回平台

更细的设计阶段说明见仓库文档 `docs/opendesign-design-stage.md`（运维向内容不在本页展开）。

## 5. 常用命令

| 命令 | 作用 |
| --- | --- |
| `flowx-local serve` | 启动本机 Agent |
| `flowx-local status` | 查看设备身份与待同步数量 |
| `flowx-local sync` | 重试 Outbox 中未回传的事件 |
| `flowx-local map <repoUrl> <path>` | 手动把远程仓库 URL 映射到本地目录 |

## 6. 常见问题

### Q1：页面提示「未检测到本机 flowx-local」

- 确认终端里 `flowx-local serve` 仍在运行
- 用 `curl http://127.0.0.1:3920/health` 检查是否可达
- 不要把服务绑到局域网地址；只应监听 `127.0.0.1`

### Q2：设计或完成结果进了 Outbox

通常是当时 FlowX API 不可达。先确认网络与 API，再执行：

```bash
flowx-local status
flowx-local sync
```

若短期会话凭据已过期，回到 FlowX 重新打开本地设计/启动流程后再同步。

### Q3：安装后找不到 `flowx-local` 命令

- 确认全局 npm bin 目录在 `PATH` 中
- 或改用 `npx @flowx-ai/local serve`
- 公司内网源若没有该包，请加上 `--registry https://registry.npmjs.org`

## 7. 更多帮助

- 平台总览请看侧栏「使用手册」
- 运维目录与安全边界见仓库 `docs/edge-agent-operations.md`
