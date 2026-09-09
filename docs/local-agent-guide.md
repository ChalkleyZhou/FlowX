# FlowX 本地 Agent 使用指南

把 FlowX 接到本机 Cursor / Codex / WorkBuddy。Skill 是流程说明，MCP 是工具，安装脚本会一起写入。

## 安装

macOS / Linux：

```bash
curl -fsSL https://<当前站点>/install | bash
flowx-local login
```

Windows（PowerShell）：

```powershell
irm https://<当前站点>/install.ps1 | iex
flowx-local login
```

需要 Node.js 20+（没有则到 https://nodejs.org/ 安装后重跑）。脚本会装包、注册后台服务（macOS LaunchAgent / Linux systemd --user / Windows 计划任务），检测到 Cursor / Codex 时询问是否写入需求登记、产品构思、Spec & Plan、本地冒烟四个 FlowX Skill 和 MCP。WorkBuddy 请再执行 `flowx-local setup workbuddy`。`login` 只粘贴设置页生成的 `fxpat_…`。

## 怎么用

- **新建需求**：在 IDE 里明确说要「在 FlowX 新建需求」。普通写代码不会登记；说不清时 Agent 会先问。流程：选项目 → 确认版本 → 创建需求 → **你确认后再启动工作流**。
- **本地开发**：工作流进入待执行后，网页点「本地启动」，选 Cursor / Codex / WorkBuddy。
- **构思 / 设计**：`flowx_list_tasks` → bind → 提交 `prd.md` → 同一会话拉设计 handoff → 提交 `design.md` 与 HTML。
- **Spec & Plan**：绑定 `spec-plan` 阶段后调用 `flowx_get_spec_plan_handoff`，生成结构化 `spec-plan.json`、`spec.md` 和 `plan.md`。先用 `flowx_upload_artifact` 分别上传两个 Markdown 文件，再以返回的 Artifact ID 调用 `flowx_submit_spec_plan`；回传后仍在网页人工确认。
- **多人多端冒烟**：使用 `flowx_create_smoke_run` 创建目标端矩阵，或用 `flowx_list_smoke_tasks` 查看已有轮次。每位开发者按目标端调用 `flowx_claim_smoke_task` 领取未占用用例，上传日志、截图、JUnit 或 coverage 后调用 `flowx_submit_smoke_report`。同一用例的多人结果会在服务端汇总，原始结果不会相互覆盖。

旧 Skill 名 `flowx-brainstorm-spec` 请执行 `flowx-local update`。无参数的 `flowx-local update` 只刷新本机已有 Skill 的目标；已在用 Cursor / Codex、尚未装 WorkBuddy 的用户，请执行 `flowx-local setup workbuddy` 或 `flowx-local update workbuddy`。更细的设计回传格式见仓库 `docs/opendesign-design-stage.md`。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `flowx-local login` | 写入 Personal API Token |
| `flowx-local status` | 后台服务与待同步数量 |
| `flowx-local update` | 升级本机包并刷新 Skill / MCP / 服务 |
| `flowx-local sync` | 重试完成报告和资料上传 Outbox；资料使用稳定副本，不依赖原文件继续存在 |
| `flowx-local map <repoUrl> <path>` | 映射远程仓库到本地目录 |
| `flowx-local logout` | 清除本机凭据 |

## 排障

| 情况 | 处理 |
| --- | --- |
| 网页提示未检测到 | `flowx-local status`，或 `curl http://127.0.0.1:3920/health` |
| 找不到命令 | 把 npm 全局 bin 加入 `PATH`；或 `npm install -g @flowx-ai/local --registry https://registry.npmjs.org` 后 `flowx-local setup --api-base-url https://你的站点/api` |
| `irm` 被策略拦截 | `powershell -ExecutionPolicy Bypass -c "irm https://你的站点/install.ps1 | iex"` |
| `login` 询问地址 / 连错环境 | `flowx-local login --api-base-url https://你的站点/api --token fxpat_…` |
| 完成结果进了 Outbox | `flowx-local sync` |
| 资料上传显示 `queued: true` | 保留本机登录凭据并执行 `flowx-local sync`；成功后稳定副本会自动清理 |
| 命令与文档不一致 | `flowx-local version`，再重跑当前站点的 `/install` |

不要把 `~/.flowx` 下的凭据或 token 提交到 Git。贡献者排障可用 `pnpm flowx-local serve`。
