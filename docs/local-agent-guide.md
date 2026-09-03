# FlowX 本地 Agent 使用指南

把 FlowX 接到本机 Cursor / Codex。Skill 是流程说明，MCP 是工具，安装脚本会一起写入。

## 安装

在日常使用的同一 FlowX 站点执行：

```bash
curl -fsSL https://<当前站点>/install | bash
flowx-local login
```

需要 Node.js 20+（没有则到 https://nodejs.org/ 安装后重跑）。脚本会装包、注册后台服务，检测到 Cursor / Codex 时询问是否写入 Skill 和 MCP。`login` 只粘贴设置页生成的 `fxpat_…`。暂不支持 Windows。

## 怎么用

- **新建需求**：在 IDE 里明确说要「在 FlowX 新建需求」。普通写代码不会登记；说不清时 Agent 会先问。流程：选项目 → 确认版本 → 创建需求 → **你确认后再启动工作流**。
- **本地开发**：工作流进入待执行后，网页点「本地启动」，选 Cursor / Codex。
- **构思 / 设计**：`flowx_list_tasks` → bind → 提交 `prd.md` → 同一会话拉设计 handoff → 提交 `design.md` 与 HTML。Spec & Plan 仍在网页确认。

旧 Skill 名 `flowx-brainstorm-spec` 请执行 `flowx-local update`。更细的设计回传格式见仓库 `docs/opendesign-design-stage.md`。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `flowx-local login` | 写入 Personal API Token |
| `flowx-local status` | 后台服务与待同步数量 |
| `flowx-local update` | 升级本机包并刷新 Skill / MCP / 服务 |
| `flowx-local sync` | 重试 Outbox |
| `flowx-local map <repoUrl> <path>` | 映射远程仓库到本地目录 |
| `flowx-local logout` | 清除本机凭据 |

## 排障

| 情况 | 处理 |
| --- | --- |
| 网页提示未检测到 | `flowx-local status`，或 `curl http://127.0.0.1:3920/health` |
| 找不到命令 | 把 npm 全局 bin 加入 `PATH`；或 `npm install -g @flowx-ai/local --registry https://registry.npmjs.org` 后 `flowx-local setup --api-base-url https://你的站点/api` |
| `login` 询问地址 / 连错环境 | `flowx-local login --api-base-url https://你的站点/api --token fxpat_…` |
| 完成结果进了 Outbox | `flowx-local sync` |
| 命令与文档不一致 | `flowx-local version`，再重跑当前站点的 `/install` |

不要把 `~/.flowx` 下的凭据或 token 提交到 Git。贡献者排障可用 `pnpm flowx-local serve`。
