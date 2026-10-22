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

不需要预先安装 Node.js。脚本会优先复用已有的 Node.js 20+；没有可用版本时，会把固定版本的 FlowX 私有 runtime 安装到 `~/.flowx/runtime`，再把包和启动器安装到 `~/.flowx`。之后注册后台服务（macOS LaunchAgent / Linux systemd --user / Windows 计划任务），检测到 Cursor / Codex 时询问是否写入继续流程、需求登记、产品构思、Spec & Plan、本地执行、本地冒烟这几个 FlowX Skill 和 MCP。WorkBuddy 请再执行 `flowx-local setup workbuddy`。`login` 只粘贴设置页生成的 `fxpat_…`。

## 怎么用

- **新建需求**：在 IDE 里明确说要「在 FlowX 新建需求」。普通写代码不会登记；说不清时 Agent 会先问。流程：选项目 → 确认版本 → 创建需求 → **你确认后再启动工作流**。启动后按当前阶段继续，不固定进入构思。
- **继续流程**：说「接着做这条 FlowX」。Agent 先调用 `flowx_get_workflow_position` 读取服务器上的当前阶段及最新已确认的上游产物。PRD、设计确认后可从 Spec & Plan 或执行继续，等待网页确认时不生成下一步；他人已领取时返回 `localAction: none`，应等待当前执行人回传。网页需求详情也可直接继续已有流程，多条活跃流程按仓库范围选择。
- **生成方式**：只对当前阶段选择一次。用自己的技能时按该阶段契约生成，文件已经在本地就确认后提交；或使用 FlowX 对应技能生成。这个选择不留给下一个人。
- **本地开发**：网页点「本地启动」后选 Cursor / Codex / WorkBuddy。启动只写入项目 MCP，不把 FlowX 生成技能放进仓库。
- **运行控制**：新版本地 Agent 会在开始、等待和重要操作前后调用执行检查点。网页可以请求取消、恢复阻塞任务或请求同步；Agent 领取命令后才执行并回执。取消不会强杀 Cursor/Codex 进程，必须在本地确认由本任务启动的操作已经停止后回执。超过 5 分钟未收到检查点会显示“失联”，这表示平台没有新回报，不代表平台已经停止本地进程。
- **并行开发进展**：网页“看板”中的开发进展按项目、执行人、工具、状态和需求名称筛选本地开发任务，每页 20 条。有实质进展时，本地 Agent 在 `flowx_execution_checkpoint` 中携带可选的 `progressSummary`（最多 2000 字符），说明已完成什么、正在做什么；普通保活可省略。相同摘要重试不会重复写进度事件，终态和等待停止回执的任务不会被新摘要覆盖。使用新版客户端并重新加载 IDE 的 FlowX MCP/执行技能后，Agent 才能使用该参数；旧客户端仍可回报检查点，页面明确提示缺少具体进度。这里不自动读取 IDE 对话。
- **完成回传**：完成报告要携带 handoff 返回的 `executionSessionId`。本地工具会按工作流的 `baseBranch` 与当前分支的共同基线收集已提交文件，因此提交并推送后工作区干净仍可以完成；分支不一致或存在待处理控制命令时会拒绝提交。
- **构思 / 设计**：确认当前阶段后领取并提交 `prd.md`，再领取设计任务、提交 `design.md` 与 HTML。同阶段只允许一个有效执行会话，原领取人可幂等重试；其他人不能复用该会话回传，同时领取只有一人成功。
- **Spec & Plan**：确认当前阶段后生成 `spec-plan.json`、`spec.md` 和 `plan.md`。先用 `flowx_upload_artifact` 分别上传两个 Markdown 文件，再以返回的 Artifact ID 调用 `flowx_submit_spec_plan`；回传后仍在网页人工确认。
- **多人多端冒烟**：使用 `flowx_create_smoke_run` 创建目标端矩阵，或用 `flowx_list_smoke_tasks` 查看已有轮次。每位开发者按目标端调用 `flowx_claim_smoke_task` 领取未占用用例，上传日志、截图、JUnit 或 coverage 后由原领取人调用 `flowx_submit_smoke_report`。不能代用他人会话回传；同一用例的多人结果会在服务端汇总，原始结果不会相互覆盖。

旧 Skill 名 `flowx-brainstorm-spec` 请执行 `flowx-local update`。无参数的 `flowx-local update` 只刷新本机已有 Skill 的目标；已在用 Cursor / Codex、尚未装 WorkBuddy 的用户，请执行 `flowx-local setup workbuddy` 或 `flowx-local update workbuddy`。更细的设计回传格式见仓库 `docs/opendesign-design-stage.md`。

## 核对本地状态与换人交接

工作流详情的“当前任务”通过只读查询显示执行人和已有本地回报，打开页面不会自动领取任务。领取时间不能证明 IDE 已启动；缺少真实回报时显示“尚未确认本地运行状态”，失联也不代表原设备已停止。缺少执行人记录的历史会话不会自动归给当前用户，不能直接继续回传。

本地构思、设计和 Spec & Plan 的旧非协作式任务需要换人时，原执行人或同组织管理员先在原设备停止任务，再在网页点击“结束本次本地任务”，勾选停止确认并填写原因；无执行人记录的历史任务仅同组织管理员可处理。平台会结束旧会话、保留失败尝试及审计，下一人领取新尝试，旧会话的晚到回传会被拒绝。会话取消后也不能通过通用上传、事件或状态接口追加旧结果；新设计稿记录原执行会话，未记录执行人的历史稿只读。此操作不能远程关闭 IDE，也不会因失联自动发生。开发阶段的协作式会话继续使用停止请求和本地回执。

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
| 找不到命令 | 新开终端使 `~/.flowx/bin` 的 PATH 配置生效；或直接执行 `~/.flowx/bin/flowx-local login` |
| `irm` 被策略拦截 | `powershell -ExecutionPolicy Bypass -c "irm https://你的站点/install.ps1 | iex"` |
| `login` 询问地址 / 连错环境 | `flowx-local login --api-base-url https://你的站点/api --token fxpat_…` |
| 完成结果进了 Outbox | `flowx-local sync` |
| 资料上传显示 `queued: true` | 保留本机登录凭据并执行 `flowx-local sync`；成功后稳定副本会自动清理 |
| 命令与文档不一致 | `flowx-local version`，再重跑当前站点的 `/install` |

不要把 `~/.flowx` 下的凭据或 token 提交到 Git。贡献者排障可用 `pnpm flowx-local serve`。
