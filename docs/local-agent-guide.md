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

不需要预先安装 Node.js。脚本会优先复用已有的 Node.js 20+；没有可用版本时，会把固定版本的 FlowX 私有 runtime 安装到 `~/.flowx/runtime`，再把包和启动器安装到 `~/.flowx`。之后注册后台服务（macOS LaunchAgent / Linux systemd --user / Windows 计划任务），检测到 Cursor / Codex 时询问是否写入继续流程、需求登记、产品构思、Spec & Plan、本地执行、本地冒烟、操作去向这几个 FlowX Skill 和 MCP。WorkBuddy 请再执行 `flowx-local setup workbuddy`。`login` 只粘贴设置页生成的 `fxpat_…`。

## 自动更新

`@flowx-ai/local@0.8.0` 已包含以下自动更新能力；已有 `0.7.2` 用户请先执行一次 `flowx-local update` 或重新运行站点安装脚本，再重新加载 IDE 的 FlowX MCP。

默认在 CLI 启动、IDE 连接 FlowX MCP、调用 MCP 工具或网页请求本地服务时触发后台检查。五分钟内复用结果，空闲时不轮询；检查、下载和安装不阻塞本次操作。只自动安装 npm 官方源 `latest` 指向的稳定版本，新版校验失败或网络不可用时继续使用现有版本。

新版准备好后，下次 CLI/MCP 启动生效；后台服务收到新版就绪事件后，等待全部请求及业务处理结束再切换；空闲时直接切换，无需再发请求。已经连接的 MCP 保留原版本，需要重新加载 IDE 的 FlowX MCP 才能使用新版工具列表；已经加载的 Skill 也可能需要新会话重新读取。未修改的已安装 FlowX Skill 会同步刷新，自定义内容保留。自动更新不会为尚未安装的 IDE 新增配置；MCP 已指向稳定入口且内容无需更新时，不重写配置文件，避免触发 IDE 无谓重载。

执行 `flowx-local status` 查看 `update.runningVersion`（当前 CLI）、`update.readyVersion`（下次启动可用版本）、`service.version`（后台服务实际版本）、`checkedAt`（最近检查的 Unix 毫秒时间）、`result`（`current` / `ready` / `failed`）和 `failure`（`check` / `install` / `verify`）。检查尚未完成时，后几项可能省略；`skippedSkills` 列出保留的自定义 Skill 或未能刷新的配置文件。需要立即更新时仍可执行 `flowx-local update`；该命令默认按既有行为强制刷新所选 Skill，使用 `--no-force` 保留已有文件。

关闭自动检查：在 `~/.flowx/local.json` 保留原配置并增加 `"autoUpdate": false`，或为对应进程设置 `FLOWX_LOCAL_AUTO_UPDATE=0`；重启现有进程后生效。关闭检查不会撤回已准备的版本，手动 `update` 仍可使用。源码开发目录自动跳过安装更新，使用仓库构建命令。

## 怎么用

- **操作去向**：新建需求、上传用例，以及其他要写入 FlowX 且可能落到多处的操作，都先确定落点。本机记住了项目和对应容器时，只问是否继续在那里；没有记录时先列出项目，再选版本或用例库。同一批只确认一次。已经点名的工作流、工作项或执行会话直接用那条，不再重选项目。工作区随项目确定。
- **新建需求**：在 IDE 里明确说要「在 FlowX 新建需求」。普通写代码不会登记；说不清时 Agent 会先问。只需标题和有效发布版本；描述、验收标准、优先级、功能模块、风险与影响、产品需求文档和备注可留空，后续构思中完善。没说优先级时按中创建。无当前版本时需选择已有版本或先创建版本，不支持以 `null` 创建未挂版本需求。流程：选项目 → 确认版本 → 创建需求 → **你确认后再启动工作流**。启动后按当前阶段继续，不固定进入构思。明确要求时也可以编辑或删除已有需求；删除前会再次确认，执行中或已纳入测试的需求会被拒绝。把工作项移出当前版本时传 `versionId: null`，只解除版本归属，不删除工作项。
- **继续流程**：说「接着做这条 FlowX」。Agent 先调用 `flowx_get_workflow_position` 读取服务器上的当前阶段及最新已确认的上游产物。列出任务时可以按项目、发布版本、规划状态和优先级筛选；版本和规划状态只筛需求。PRD、设计确认后可从 Spec & Plan 或执行继续，等待网页确认时不生成下一步；他人已领取时返回 `localAction: none`，应等待当前执行人回传。网页需求详情也可直接继续已有流程，多条活跃流程按仓库范围选择。
- **需求变更**：在网页需求或工作流详情点击「需求变更」，或让本地 Agent 提交。一句话补充会进入后续领取；重新走流程会保留旧轮。换包时给出本地 ZIP 路径，不超过 20 MiB。同一次提交重试使用同一个提交标识。新流程还没启动时，确认后继续启动，不要再记一条变更。正在运行的任务保留领取时上下文，需先结束旧任务再重新领取。领取构思、设计、Spec & Plan 和执行时，交接会带上已填写的优先级、功能模块、风险与影响、产品需求文档、备注和创建人。
- **生成方式**：只对当前阶段选择一次。用自己的技能时按该阶段契约生成，文件已经在本地就确认后提交；或使用 FlowX 对应技能生成。这个选择不留给下一个人。
- **本地开发**：网页点「本地启动」后选 Cursor / Codex / WorkBuddy。启动只写入项目 MCP，不把 FlowX 生成技能放进仓库。
- **运行控制**：新版本地 Agent 会在开始、等待和重要操作前后调用执行检查点。网页可以请求取消、恢复阻塞任务或请求同步；Agent 领取命令后才执行并回执。取消不会强杀 Cursor/Codex 进程，必须在本地确认由本任务启动的操作已经停止后回执。超过 5 分钟未收到检查点会显示“失联”，这表示平台没有新回报，不代表平台已经停止本地进程。
- **并行开发进展**：网页“看板”中的开发进展按项目、执行人、工具、状态和需求名称筛选本地开发任务，每页 20 条。有实质进展时，本地 Agent 在 `flowx_execution_checkpoint` 中携带可选的 `progressSummary`（最多 2000 字符），说明已完成什么、正在做什么；普通保活可省略。相同摘要重试不会重复写进度事件，终态和等待停止回执的任务不会被新摘要覆盖。使用新版客户端并重新加载 IDE 的 FlowX MCP/执行技能后，Agent 才能使用该参数；旧客户端仍可回报检查点，页面明确提示缺少具体进度。这里不自动读取 IDE 对话。
- **完成回传**：完成报告要携带 handoff 返回的 `executionSessionId`。本地工具会按工作流的 `baseBranch` 与当前分支的共同基线收集已提交文件，因此提交并推送后工作区干净仍可以完成；分支不一致或存在待处理控制命令时会拒绝提交。
- **构思 / 设计**：确认当前阶段后领取并提交 `prd.md`，再领取设计任务、提交 `design.md` 与 HTML。同阶段只允许一个有效执行会话，原领取人可幂等重试；其他人不能复用该会话回传，同时领取只有一人成功。
- **Spec & Plan**：确认当前阶段后生成 `spec-plan.json`、`spec.md` 和 `plan.md`。先用 `flowx_upload_artifact` 分别上传两个 Markdown 文件，再以返回的 Artifact ID 调用 `flowx_submit_spec_plan`；回传后仍在网页人工确认。
- **多人多端冒烟**：使用 `flowx_create_smoke_run` 创建目标端矩阵，或用 `flowx_list_smoke_tasks` 查看已有轮次。每位开发者按目标端调用 `flowx_claim_smoke_task` 领取未占用用例，上传日志、截图、JUnit 或 coverage 后由原领取人调用 `flowx_submit_smoke_report`。不能代用他人会话回传；同一用例的多人结果会在服务端汇总，原始结果不会相互覆盖。

旧 Skill 名 `flowx-brainstorm-spec` 请执行 `flowx-local update`。无参数的 `flowx-local update` 只刷新本机已有 Skill 的目标；已在用 Cursor / Codex、尚未装 WorkBuddy 的用户，请执行 `flowx-local setup workbuddy` 或 `flowx-local update workbuddy`。更细的设计回传格式见仓库 `docs/opendesign-design-stage.md`。

## 多人开发的分支交付

多人多端开发可共用工作流中已确认的 PRD、设计与方案，自行在各自 IDE 开发，不需要先领取统一开发任务。推送代码后，在网页工作流的“代码交付”选择仓库并填写分支；无需本地执行会话或手填 commit、变更清单。多人可提交各自仓库或同仓不同分支，由平台记录身份和版本，最后每仓选定一条交付分支统一确认。

确认时平台读取真实 Git diff 并冻结 commit；分支改变需重新提交，测试与联调仍需真实证据。已确认版本进入既有审查和提测。当前网页提交是本能力入口，不新增本地 MCP 工具；处于分支收集阶段的当前位置查询返回 `none` 并提示继续自行开发后提交分支，避免旧客户端领取整个流程。

原本地执行技能继续适用于单人会话模式；正在运行的原会话应走原停止/完成入口后再选择分支交付。分支模式不远程启动、监控或停止个人 IDE。

## 核对本地状态与换人交接

工作流详情的“当前任务”通过只读查询显示执行人和已有本地回报，打开页面不会自动领取任务。领取时间不能证明 IDE 已启动；缺少真实回报时显示“尚未确认本地运行状态”，失联也不代表原设备已停止。缺少执行人记录的历史会话不会自动归给当前用户，不能直接继续回传。

本地构思、设计和 Spec & Plan 的旧非协作式任务需要换人时，原执行人或同组织管理员先在原设备停止任务，再在网页点击“结束本次本地任务”，勾选停止确认并填写原因；无执行人记录的历史任务仅同组织管理员可处理。平台会结束旧会话、保留失败尝试及审计，下一人领取新尝试，旧会话的晚到回传会被拒绝。会话取消后也不能通过通用上传、事件或状态接口追加旧结果；新设计稿记录原执行会话，未记录执行人的历史稿只读。此操作不能远程关闭 IDE，也不会因失联自动发生。开发阶段的协作式会话继续使用停止请求和本地回执。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `flowx-local login` | 写入 Personal API Token |
| `flowx-local status` | 后台服务、待同步数量、运行版本与更新状态 |
| `flowx-local update` | 立即检查并准备新版，刷新所选 Skill / MCP / 服务；`--no-force` 保留已有 Skill |
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


## 完整功能测试与回归

在平台准备测试设计并确认范围后，创建功能初测或 Bug 回归本地轮次。新版 `flowx-local-test` 技能用于完整功能测试与回归；原 `flowx-local-smoke` 继续只负责冒烟门禁。

平台“在本地执行”通过五分钟一次性票据交接本机，绑定原领取人、组织、设备和测试轮次。兑换后本地核对仓库映射、分支、HEAD 和业务工作区；不匹配时拒绝打开 IDE 并释放领取范围。启动失败也释放。需要支持该源码能力的新本地包，并在更新后重载 IDE MCP；本次仓库变更不等于已发布 npm 新版本。

本地 Agent 可使用以下正式工具，不需要解析网页或访问数据库：

- 选例：`flowx_list_test_libraries`、`flowx_list_test_modules`、`flowx_list_test_cases`、`flowx_create_test_design`、`flowx_get_test_design`、`flowx_update_test_selection`、`flowx_add_test_candidates`、`flowx_update_test_candidate`、`flowx_update_test_smoke`、`flowx_generate_test_design`、`flowx_confirm_test_design`。检索结果包含用例画像。`applicableEnds` 为 `phone`、`glasses`、`platform`、`backend`；`@flowx-ai/local` `0.8.0` 起，`flowx_update_test_candidate` 的 `proposedCase` 可以写入这些可选字段。`flowx_create_test_case` 向已确认的项目新建正式用例：先用 `flowx_list_case_libraries` 按 `projectId` 列出项目用例库，由用户选择 `libraryId`，或明确给出 `newLibraryName` 新建项目专属库。缺少项目或用例库去向时工具会拒绝，不会写入工作区共享库。这些能力在 `@flowx-ai/local` `0.8.0`。`0.7.1` 因协议导出缺失无法启动。执行 `flowx-local update` 后重新加载 IDE 的 FlowX MCP。旧调用不传新字段仍然有效。执行轮次的 `targetKeys` 与适用端相同：`phone`、`glasses`、`platform`、`backend`。
- 提测：`flowx_test_requests` 支持 `list/get/create/prepare`，创建后保持草稿；检查真实冻结范围并获得用户确认后显式 `prepare`，传入 `scopeRevision`。存在冒烟快照时仍需通过原门禁。
- 执行：`flowx_create_test_run`、`flowx_list_test_tasks`、`flowx_claim_test_task`、`flowx_report_test_progress`、`flowx_submit_test_report`、`flowx_control_test_execution`。
- 闭环：`flowx_link_test_bug`、`flowx_finish_test_run`、`flowx_test_reports`（轮次或提测汇总）；证据复用 `flowx_upload_artifact`。

执行顺序：查询任务 → 领取目标端与用例（平台已交接领取时不再重复领取）→ 核对所有代码版本 → 真实执行 → 上传证据 → 用稳定幂等键分批回传 → 全部领取项回传后完成会话。报告必须携带领取时的 `testRunRevision`、`sourceFingerprint`、实际 `testedRevisions` 和逐例结果。相同内容重试使用同一幂等键；内容变化用新键，已保存事实不能覆盖。生成脚本、IDE 打开或心跳都不等于测试通过。

长时间执行需通过 `flowx_control_test_execution` 的 `heartbeat` 续租；过期后重新领取新会话，旧会话迟到结果被拒绝。中断先停止本地进程，再用 `release` 或 `cancel` 并说明原因；服务端返回 `deviceStopped: false` 表示仍需确认设备已停止。已接受的结果继续保留；省略 `caseIds` 再次领取时只包含未完成项。需要重测时优先创建新轮次，显式选择已有结果的同轮复测继续采用保守聚合，不覆盖原执行事实。

回归必须绑定本项目已完成修复的 Bug，使用修复工作流交付版本。失败结果独立关联缺陷，不能用手工结果入口覆盖本地事实。回归和显式汇总不会改写初测或旧报告。能力查询不支持时返回明确错误，不能改用旧 smoke 工具回传正式功能结果。

质量启动内部注入 `FLOWX_QUALITY_TEST_RUN_ID` 与 `FLOWX_QUALITY_EXECUTION_SESSION_ID`，让 MCP 使用交接的短期身份；无需手工配置。不要记录或分享交接 token。

## 分页读取记录

本地工具适配结论：**需要适配**。项目、版本、仓库、需求/缺陷混合任务、OpenDesign 任务、用例库、模块、用例及测试任务等记录发现入口支持分页与搜索，工具 schema 的参数实际透传 API，返回保留 `items/total/page/pageSize/totalPages`。按用户需要请求下一页；不要循环读完全部页，也不要把当前页当作完整业务范围。已有精确 ID 的详情和执行上下文入口继续复用，领取、确认和报告不以列表页内容替代完整范围。

HTTP 记录列表默认 `page=1&pageSize=20`，`pageSize` 最大 100，并要求 `X-FlowX-List-Contract: pagination-v1`。新版本地客户端自动发送该标记。旧客户端会收到 `426 / PAGINATION_UPGRADE_REQUIRED`，应更新 `@flowx-ai/local`、重新加载 IDE MCP 后重试；不要解析网页或直接读取数据库来绕过接口。更新源码不等于已发布 npm 版本，请安装包含该分页契约的配套构建。

`flowx_list_projects` 可通过 `resource` 选择项目、版本或仓库，配合明确的项目/工作区 ID 查询对应页。用例模块按 `parentId` 分层读取，根层可传 `null`；搜索和页面选择不会改变服务端冻结范围、门禁和权限。

## 版本工作项与端侧执行项

本地 Agent 可以通过 FlowX MCP 查询版本工作项并领取执行项。版本工作项的 `kind` 可以是 `REQUIREMENT`（需求）、`ISSUE`（问题）或 `BUG`（缺陷）；三类记录共用执行计划和端侧领取协议。领取、完成、阻塞和取消都使用 `executionItemId`；领取和完成使用 `claimKey`，完成时可附带 `evidence`。领取成功后服务端会创建并返回绑定该执行项的 `executionSessionId`，用于端云执行追踪。多执行项计划不能通过工作流级入口整包领取，必须逐项领取；只有单执行项计划才允许工作流级本地启动。服务端负责依赖检查、并发保护、权限校验和幂等重试；Agent 不直接操作数据库，也不自行判断是否可以合并提测。常用工具为 `flowx_list_version_work_items`、`flowx_claim_execution_item`、`flowx_complete_execution_item`、`flowx_block_execution_item` 和 `flowx_cancel_execution_item`。
