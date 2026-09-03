# 本地 Agent 安装简化设计

**Date:** 2026-09-03  
**Status:** Approved for planning  
**Scope:** 把终端用户安装从「npm + setup + 手配 MCP + 手开 serve + 默认 localhost API」收成：本机 FlowX 提供的 `curl | bash` 向导，自动写用户级 MCP、注册后台服务；`login` 只负责 token。

## Goal

日常用户在自己的 FlowX 站点上复制一条 curl，完成本机 Agent 安装；不必理解 Skill / MCP / `serve` 的分工，也不必填写 `--api-base-url`。

Skill 与 MCP **不冲突**：Skill 是流程说明书，MCP 是 `flowx_*` 工具。安装必须两者都有，但用户只看到「给 Cursor / Codex 装 FlowX」。

## Decisions

| 主题 | 选择 |
| --- | --- |
| 用户主路径 | `curl -fsSL https://<这台FlowX>/install \| bash`，然后 `flowx-local login` |
| API 地址 | curl 脚本由这台 FlowX 写入；用户不填 `--api-base-url` |
| 无 flag 的 `setup` / `login` | 已有已确认地址则沿用；否则询问。取消静默默认 `http://127.0.0.1:3000` |
| Node | 检查 ≥ 20；没有则提示 [nodejs.org](https://nodejs.org/)，**不代装** |
| MCP | `setup` 写入**用户级**配置；不写 token / API 地址 |
| `serve` | 用户不手开；`setup` 注册 macOS LaunchAgent / Linux systemd --user，登录后自启 |
| `setup --no-ide` | 只写 API 地址 + 后台服务；curl 第一步使用 |
| Cursor / Codex | curl 向导：**检测到才问**是否写 Skill + MCP |
| OpenDesign | curl 向导不检测；MCP 走 Cursor Agent |
| Windows | 本变更不做 |
| 独立二进制 / 代装 Node | 不做 |

## 不在本变更

- Windows 服务与 PowerShell 安装器
- 把 `@flowx-ai/local` 打成 Cursor 式独立二进制
- curl 脚本代装 Node
- 自定义协议 `flowx://` 替代 loopback daemon
- 修改网页「本地启动」写入项目级 `.cursor/mcp.json` 的兼容路径（credentials 仍优先）
- OpenDesign 应用内 MCP 配置

## User flow

```text
curl https://<host>/install | bash
  → 检查 Node（不够则退出并给出 nodejs.org）
  → npm i -g @flowx-ai/local
  → flowx-local setup --api-base-url <本机 API>（地址 + 后台服务）
  → 若检测到 Cursor / Codex，分别询问是否安装 Skill + MCP
  → 打印 login 提醒（不代做、不索要 token）

flowx-local login
  → 只询问 / 接收 token；地址已在 local.json
```

贡献者 / 排障仍可用 `npm i -g`、`flowx-local setup`、`flowx-local serve`。

## `/install` 脚本

### 路由

`GET /install` **无需登录**（`@Public()`），`Content-Type: text/x-shellscript; charset=utf-8`，`Content-Disposition: inline`。

站点根路径必须能访问到该脚本（用户命令是 `https://<host>/install`，不是 `/api/install`）：

- Docker Nginx：增加 `location = /install`，反代到 API 容器（与 `/api/` 同一上游，**不要** strip `/install` 前缀之外的错误 rewrite）
- Vite dev：`server.proxy['/install']` → `http://127.0.0.1:3000/install`
- 运维文档同步 Nginx 片段

脚本由 **这台 FlowX 动态生成**，不从 GitHub/npm 拉取，避免连错环境。

### 写入脚本的 API 地址

按顺序：

1. `PUBLIC_API_BASE_URL` 或 `FLOWX_PUBLIC_API_BASE_URL`（去尾斜杠）
2. 否则用请求的公网 origin + `/api`（尊重 `X-Forwarded-Proto` / `Host`）

**禁止**把 `http://127.0.0.1:3000` 作为安装脚本的静默默认。本机开发若 curl 的就是 loopback 站点，origin 本身就是 loopback，那是用户显式打到本机，允许。

### 向导步骤

1. **Node**  
   `node -v` 主版本 ≥ 20 则继续。否则打印需要 Node 20+、下载地址 `https://nodejs.org/`、以及同一条 curl，以非零退出。不询问是否代装。

2. **装包**  
   `npm install -g @flowx-ai/local --registry https://registry.npmjs.org`。失败则退出，不跑 `setup`。

3. **setup（不问 IDE）**  
   解析到 `flowx-local` 绝对路径后执行：  
   `flowx-local setup --api-base-url <嵌入的 API> --no-ide`  
   此步只写入 `local.json` 的 API 地址，并注册、立即启动后台服务。不写 Skill / MCP。

4. **Cursor / Codex（检测到才问）**

   | 目标 | 视为已安装 |
   | --- | --- |
   | Cursor | `/Applications/Cursor.app`、`~/Applications/Cursor.app`，或 PATH 中有 `cursor` |
   | Codex | 对应 `.app`，或 PATH 中有 `codex` |

   每检测到一个，问：「检测到 Cursor，要安装 FlowX Skill 和 MCP 吗？[Y/n]」（Codex 同理）。Y 则对该 target 写 Skill + 用户级 MCP；n 跳过。未检测到的不问、不装，提示未找到。

   OpenDesign 不检测。

5. **结束提醒**  
   打开 `https://<host>/settings/api-tokens` 生成 `fxpat_…`，然后执行 `flowx-local login`。脚本不读取、不保存 token。

### 非 TTY

`curl | bash` 会占用 stdin，**不能**用 `[ -t 0 ]` 判断能否提问。可交互的判定是能读控制终端：`[ -r /dev/tty ]`，`read` 从 `/dev/tty` 取答。

没有 `/dev/tty` 时：Node 检查仍执行；装包 + 带 API 的 `setup`（地址 + 后台）仍执行；IDE 集成跳过，并打印可稍后执行的 `flowx-local setup cursor` / `flowx-local setup codex`。

## `flowx-local setup`

在现有 Skill 安装之上增加：API 地址确认、后台服务、按 target 写 MCP。

### API 地址

解析顺序：`--api-base-url` → `FLOWX_API_BASE_URL` → `local.json` 中**已确认**的地址 → **询问**。

视为未配置（必须询问或失败）：

- 空
- 仅存在历史默认 `http://127.0.0.1:3000` 或 `http://localhost:3000`（去尾斜杠后精确匹配）

用户显式传入或输入 loopback 地址是允许的（本机开发）。空输入 / 取消 → 非零退出，不把 localhost 写进配置。

curl 主路径始终带 `--api-base-url`，不会走到询问。

### Skill

- 默认（无 `--no-ide`）：对指定 target（缺省 `cursor,codex,od`）写 Skill，并对 Cursor/Codex 写用户级 MCP；同时处理 API 地址与后台服务。  
- `--no-ide`：只做 API 地址 + 后台服务，供 curl 第一步使用。  
- `--force`：仍只覆盖已有 Skill 文件；MCP 的 `flowx` 条目每次都刷新。  
- curl 在用户对某个 IDE 答 Y 之后执行 `flowx-local setup cursor` 或 `setup codex`（可带 `--force` 以外的既有参数）。已写入的 API 地址与服务不重复询问、不重复注册失败即视为已存在可更新。

### 用户级 MCP

| 目标 | 文件 | 内容 |
| --- | --- | --- |
| Cursor | `~/.cursor/mcp.json` | `mcpServers.flowx = { command: <绝对路径>, args: ["mcp"] }` |
| Codex | `~/.codex/config.toml` | `[mcp_servers.flowx]` 的 `command` + `args` |
| OpenDesign | 不写 MCP | 仅 Skill 到 `~/.agents/skills` |

规则：

- `command` 与 LaunchAgent 使用同一次解析的 `flowx-local` **绝对路径**
- **不写** `FLOWX_API_TOKEN` / `FLOWX_API_BASE_URL`
- 保留文件中其它 MCP；只 upsert `flowx`
- 每次 `setup` / `update` 都刷新 `flowx` 的 command/args（不依赖 `--force`）
- 若旧 `flowx` 条目带有上述两个 env，删除它们
- Codex 用 TOML 解析后只改 `[mcp_servers.flowx]`；解析失败则中止，不覆盖整份 `config.toml`
- 找不到可执行文件 → 失败，不写残缺 MCP
- JSON/TOML 损坏 → 失败并打印路径

项目级 `.cursor/mcp.json`（网页「本地启动」）本变更不改。运行时仍是 `credentials.json` 优先于短期 token。

## 后台服务

`setup` 注册用户级服务，**立即启动**，登录后自动起。`KeepAlive` / `Restart=always`。plist/unit 必须用 **`process.execPath`（node 绝对路径）+ `flowx-local` 绝对路径** 启动，并把 `dirname(execPath)` 放进服务 `PATH`，避免 LaunchAgent/systemd 默认 PATH 找不到 Homebrew / nvm 的 node。

| 平台 | 产物 |
| --- | --- |
| macOS | `~/Library/LaunchAgents/ai.flowx.local.plist` |
| Linux | systemd user unit（如 `~/.config/systemd/user/flowx-local.service`） |
| Windows | 不做；`/install` 说明不支持 |

日志：`~/.flowx/logs/serve.log`。  
`flowx-local update`：重写服务定义（路径可能变化）并重启。  
`flowx-local serve`：保留给贡献者与排障；用户文档不作为步骤。  
`flowx-local status`：能看服务是否加载、`127.0.0.1:3920/health` 是否通过。  
注册失败 → `setup` 非零退出。

## `flowx-local login`

仍只负责 Personal API Token。

地址解析与 `setup` 相同：flag / 环境变量 / 已确认 `local.json`；否则询问。历史默认 3000 视为未配置。

Token 校验失败（含连错地址）：**不写** `credentials.json`。废除「连不上 localhost 也 Saving token anyway」这条路径。

已确认地址后，无 `--token` 时仍可交互粘贴 token（现状保留）。

## 失败处理摘要

| 情况 | 行为 |
| --- | --- |
| Node 缺失或 < 20 | 提示 nodejs.org + 重跑 curl，退出 |
| npm 全局安装失败 | 退出，不 setup |
| 无 `flowx-local` / 服务注册失败 | setup 失败 |
| 单个 IDE 配置文件损坏 | 该 target 失败；已装的后台服务不回滚 |
| 非 TTY | 跳过 IDE 询问；地址+后台仍装 |
| login 地址未确认或校验失败 | 不写 credentials |
| Windows 跑 `/install` | 明确不支持并退出 |

## 文档

同步（源文件 + `apps/web/public` 镜像，交付前 `cmp`）：

- `docs/local-agent-guide.md`：主路径改为 curl + login；安装章缩短；Skill/MCP 一句分工；`serve` / `--api-base-url` 放到排障
- `docs/user-manual.md`、根 `README.md`、`docs/edge-agent-operations.md`、`docs/web-local-ide-launch.md`、`docs/docker-deployment.md`（Nginx `/install`）
- 网页「未检测到本机 Agent」的 copyable 命令改为当前 origin 的 curl，而不是只显示 `npm i -g` + `flowx-local serve`
- `/local-agent` 页描述改为安装 curl 向导，而不是「先启动 serve」

## 测试

- `setup` 合并用户级 Cursor MCP / Codex TOML；不写 token；保留其它 server
- 历史 `http://127.0.0.1:3000` 视为未配置；显式 `--api-base-url` 到该地址仍接受
- `GET /install` 公开可访问；body 为 shell；含嵌入的 API 地址与 nodejs.org
- `login` 无已确认地址时不默认 3000、不在校验失败时写 credentials
- 后台服务模板含绝对路径与 `serve`
- Web 未检测到 daemon 时的文案含 `/install` curl（按部署 origin）

至少覆盖：`pnpm --filter @flowx-ai/local test`、`pnpm --filter flowx-api test`（install 路由）、`pnpm --filter flowx-web test`（安装文案）。手册镜像 `cmp`。

## 风险

- LaunchAgent 绝对路径在用户切换 Node 版本后可能失效；`flowx-local update` 必须重写服务与 MCP command
- 企业环境禁止 `curl | bash`：文档保留 `npm i -g` + `setup --api-base-url` 作为等价路径
- Codex `config.toml` 用户手改风格可能无法 round-trip；解析失败必须中止而不是重写全文
