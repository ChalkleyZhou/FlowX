# 测试与质量中心基础设计

## 目标

测试与质量中心承接用例库、AI 提测范围、用例执行和 Bug 回归。它与研发工作流保持独立生命周期，通过 `Requirement`、`WorkflowRun`、`Artifact` 和 `Bug` 建立可追溯关系。

当前支持需求选例、提测前冒烟、完整功能测试、本地执行、缺陷回归和版本化测试报告；不包含传统提测审批、周排期及独立通知中心。

## 领域关系

```text
Workspace
├── TestCaseLibrary(scope=WORKSPACE)
└── Project
    ├── TestCaseLibrary(scope=PROJECT)
    └── ProjectVersion
        └── TestRequest
            ├── Requirement[]
            ├── WorkflowRun[]
            ├── Artifact[]
            └── TestPlan
                ├── TestCaseSnapshot[]
                └── TestRun[]
                    └── TestRunCase → TestResult → Bug?
```

- Workspace 共享库用于跨项目复用的通用用例。
- 项目库只对所属项目可见。
- `TestCaseDefinition` 是持续维护的用例定义；进入提测范围时复制为不可变的 `TestCaseSnapshot`。
- 快照记录源用例及版本、AI 选择理由和影响等级，库内用例后续变化不会改写历史执行事实。
- `TestRequest` 必须关联明确的 `ProjectVersion`、至少一个 `Requirement`，以及已经完成的研发 `WorkflowRun`。

## 状态

提测状态没有 `REJECTED` 或传统审批状态：

```text
DRAFT → READY → IN_TEST → PASSED | FAILED | BLOCKED
  └──────────────→ CANCELLED
PASSED | FAILED | BLOCKED → IN_TEST（新一轮回归）
```

AI 负责生成和解释测试范围，确定性规则负责从 `DRAFT` 进入 `READY`：

1. 至少存在一个用例快照。
2. 所有关联研发工作流仍为 `done`。
3. 所有结构化 `coverageChecks` 均通过。

测试范围不完整时保持 `DRAFT`，返回缺失项，不产生“拒绝”状态。

## Bug 回归

创建 `REGRESSION` 类型的 `TestRun` 时必须关联 `sourceBugId`。Bug 必须属于当前项目，且对应的 `fixWorkflowRun` 已完成。每次修复生成新的执行轮次，不覆盖之前结果。

测试设计在 Spec & Plan 确认后可与开发执行并行生成。AI 会同时比对项目库和 Workspace 共享库，输出复用、优化、新增和不纳入候选；测试人员确认后才更新正式用例。冒烟用例按本次改动动态生成，只写入当前测试计划快照，不进入长期用例库。提测前必须存在已确认且未过期的测试设计，历史快照保持不变。

## 用例编号

`externalId` 由服务端在正式用例写入时分配，格式为 `TC-000001`，按用例库递增，不同模块共用序号。网页新建、CSV/XLSX 导入空编号及测试设计确认的 CREATE 候选统一调用编号分配函数；已有编号、REUSE/OPTIMIZE 候选及历史快照保持原样。网页编辑编号为只读。

`TestCaseLibrary.nextCaseNumber` 记录下一个流水号，默认值为 1；先更新计数器以取得写锁，再在同一事务内读取已有编号、分配并写入用例。分配会越过历史记录（包括归档）和本批导入中的 `TC-` 流水号，计数器随事务失败一并回滚。升级新增该计数器字段，不批量改写已有用例。

兼容原有 `externalId` 可选输入：旧 API 调用和导入提供的编号仍保留，省略或空白时自动生成；同库有效编号重复会拒绝创建/导入。现有本地 MCP 的 `flowx_confirm_test_design` 复用同一确认服务，`flowx_list_test_cases` 继续读取返回的 `externalId`；不新增工具，不要求本地包升级，CLI、Skill/Adapter 与 `@flowx-ai/protocol` 契约保持兼容。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/quality/case-libraries` | 创建 Workspace 共享库或项目库 |
| `GET` | `/quality/case-libraries` | 查询共享库和指定项目库 |
| `POST` | `/quality/case-libraries/:libraryId/modules` | 创建用例模块 |
| `GET` | `/quality/case-libraries/:libraryId/modules` | 查询目标用例库的模块，供创建和编辑用例时选择 |
| `PATCH` | `/quality/test-case-modules/:id` | 重命名模块或调整上级模块；禁止模块循环和库内重名 |
| `DELETE` | `/quality/test-case-modules/:id` | 删除无子模块的模块；有效用例转为未分模块并递增用例版本 |
| `POST` | `/quality/case-libraries/:libraryId/cases` | 创建用例及覆盖关系 |
| `POST` | `/quality/case-libraries/:libraryId/cases/import` | 一次导入最多 1000 条用例；整批校验后通过单次原子写入落库 |
| `GET` | `/quality/test-cases` | 查询当前项目可用的共享/项目用例；传入 `page`、`pageSize` 后返回服务端分页结果，可使用 `q`、`priority`、`libraryId` 筛选 |
| `PATCH` | `/quality/test-cases/:id` | 编辑有效用例并递增定义版本；已冻结的提测快照保持不变 |
| `DELETE` | `/quality/test-cases/:id` | 逻辑删除用例，不影响已经冻结的提测快照和历史执行结果 |
| `POST` | `/quality/test-requests` | 从项目版本、需求和已完成工作流创建提测草稿 |
| `GET` | `/quality/test-requests` | 查询提测记录 |
| `GET` | `/quality/test-requests/:id` | 查询提测、范围快照和执行轮次 |
| `POST` | `/quality/test-requests/:id/scope/cases` | 写入 AI 选用用例及选择依据 |
| `POST` | `/quality/test-requests/:id/scope/complete` | 完成规则校验；存在本地冒烟轮次时保持 `DRAFT` 等待冒烟门禁，否则进入 `READY` |
| `GET` | `/quality/test-requests/:id/runs` | 查询执行轮次和逐例结果 |
| `POST` | `/quality/test-requests/:id/runs` | 创建初测或 Bug 回归轮次 |
| `POST` | `/quality/test-run-cases/:id/result` | 写入单条用例结果并聚合轮次状态 |
| `POST` | `/quality/test-requests/:id/local-smoke-runs` | 创建多目标端本地冒烟轮次 |
| `GET` | `/quality/local-smoke-runs/:id/tasks` | 查询目标端、覆盖矩阵、租约和聚合结果 |
| `POST` | `/quality/local-smoke-runs/:id/claim` | 按目标端认领未占用用例 |
| `POST` | `/execution-sessions/:id/local-smoke/complete` | 批量回传一次本地冒烟执行结果 |
| `POST` | `/quality/local-smoke-runs/:id/finalize` | 校验门禁并生成版本化提测报告 |
| `GET` | `/quality/test-requests/:id/submission-report` | 查询最新服务端提测报告 |
| `POST` | `/quality/test-designs` | 创建测试设计草稿 |
| `GET` | `/quality/test-designs/:id` | 查询测试设计、候选和冒烟项 |
| `POST` | `/quality/test-designs/:id/generate` | 生成或重新生成候选 |

| `PATCH` | `/quality/test-designs/:id/candidates/:candidateId` | 处理功能用例候选 |
| `PATCH` | `/quality/test-designs/:id/smoke` | 编辑和确认冒烟候选 |
| `POST` | `/quality/test-designs/:id/confirm` | 确认测试设计 |

冒烟候选更新请求使用当前 `revision`，`cases` 仅提交 `id`、`title`、`priority`、`precondition`、`steps`、`expected`、`blocking`、`coverageKeys` 和 `resolution`。`testDesignId`、`sortOrder`、`createdAt`、`updatedAt` 等查询返回的只读字段不得回传；接口保留严格的未知字段校验。前端确认后使用返回的测试设计更新修订号和冒烟状态。

测试设计生成复用当前组织的 AI 凭据解析。接口只负责创建 `GENERATING` 任务并立即返回，AI 在后台执行；完成后状态变为 `WAITING_REVIEW`，失败变为 `GENERATION_FAILED`。失败时 `GET /quality/test-designs/:id` 返回可安全展示的 `generationError`，用于区分凭据、额度、限流、超时、命令行工具、模型配置、输出校验及服务异常；页面同时显示设计 ID 作为排查编号。服务端日志记录该 ID 和安全分类，AI 执行器的本地调试记录可用于进一步定位。重试或成功后清空该字段。升级前已经失败的记录可能没有失败原因，需要重新生成。

测试设计提示词直接嵌入 `test-design.output.schema.json`，让 Codex 和不执行 `--output-schema` 的 Cursor 使用同一份字段契约。所有动作（包括复用和不纳入）都必须返回完整的 `proposedCase`；候选和冒烟用例必须包含非空标题、执行步骤和预期结果。修复输出契约后，需要重新生成失败的测试设计，原失败记录不会自动重试。

所有对象沿 Workspace 继承当前组织边界。API 不允许跨 Workspace 关联项目，也不允许从其他项目用例库选择用例。

## Web 入口

测试设计候选卡片在右上角展示处理状态、底部展示操作。AI 建议不纳入的候选明确展示原因，使用“本次不测”和“按原用例复用”区分排除与复用；按原用例复用时提交原用例内容。处理后状态显示“本次不测”或“已纳入”。已纳入的 `REUSE` 候选若与原用例内容不一致，仍计入待处理且不能确认测试设计；测试人员可以改为不测、按原用例复用，或明确选择会更新原用例版本的优化。

一级导航 `测试与质量` 对应 `/quality`，展开三个独立子菜单：提测管理 `/quality/test-requests`、用例库 `/quality/test-cases`、执行记录 `/quality/test-runs`。用例库采用高密度列表和服务端分页，完整步骤与预期结果按需查看；列表提供创建、查看、编辑和删除操作，编辑可调整所属用例库、模块、标题、优先级、前置条件、测试数据、步骤、预期结果和标签。测试数据随用例进入提测快照。列表工作区的“模块管理”支持按用例库新增、重命名、调整层级和删除模块；存在子模块时必须从叶子节点开始删除，删除模块只会将有效用例转为未分模块。每次保存用例编辑或因删除模块改变归属都会递增用例定义版本，已经冻结的提测快照仍保留选例时的内容和版本。用例库支持 CSV 模板或外部 XLSX 用例表批量导入，客户端先校验列结构和逐行内容，服务端再校验编号重复和批量上限，自动创建缺失的一级、二级模块，并在同一事务写入用例；任何错误都会中止整批写入。外部 XLSX 的场景、适用范围和追溯信息以标签保存，执行记录列不进入用例定义。删除用例只会将定义归档并退出后续 AI 选例范围，不修改历史快照。提测创建只允许选择项目版本下已完成的研发工作流；AI 选例、覆盖检查和快照冻结仍由质量域 API 契约控制。


## 指定范围与正式本地测试

测试设计可选传 `caseSelection: { libraryIds, moduleIds?, priorities?, tags?, targetKeys? }`。新 Web 默认项目库，共享库由用户选择；省略该字段的旧客户端仍使用项目库和共享库。模块包含后代，各筛选维度取交集；无匹配不扩大范围。库内候选先按需求关联、文本匹配、优先级与 ID 排序，再限制 AI 输入（默认 500），`retrievalSummary` 返回可用、匹配、提供数量及是否截断。手工补选仍受库、模块与筛选权限约束，但不受 AI 数量上限限制。

`TestCaseDefinition.targetKeys` 可通过创建、编辑、导入 API 维护。空值或空数组表示适用端未确认；创建正式本地轮次必须显式提交 `{ snapshotId, targetKeys }[]`，不能将未确认解释为所有端。提测快照冻结测试数据、适用端、源版本和覆盖依据。调整测试设计选择范围用 `revision` CAS，清理旧候选；生成抢占也绑定选择版本，避免旧范围异步写入。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/quality/capabilities` | 查询增量能力；不支持时不能退回冒烟语义 |
| `PATCH` | `/quality/test-designs/:id/selection` | `{ revision, caseSelection }` 更新选择范围 |
| `POST` | `/quality/test-designs/:id/candidates` | `{ revision, definitionIds }` 人工补选 |
| `POST` | `/quality/test-requests/:id/prepare` | `{ scopeRevision }` 校验已确认设计、冻结范围及研发完成，存在冒烟用例时保留冒烟门禁 |
| `POST` | `/quality/test-requests/:id/local-test-runs` | `{ name, runType, sourceBugId?, targets, cases }` 创建正式本地轮次 |
| `GET` | `/quality/local-test-tasks` | 按项目、发布版本、提测查询活动质量轮次 |
| `GET` | `/quality/test-runs/:id` | 轮次、快照、目标端、逐例事实、缺陷及执行明细 |
| `GET` | `/quality/test-runs/:id/tasks` | 本地轮次可领取范围与基线；旧人工轮次不提供领取 |
| `POST` | `/quality/test-runs/:id/claim` | `{ targetId, caseIds?, deviceId?, leaseSeconds? }` 原子领取；省略 `caseIds` 时只领取未完成项 |
| `POST` | `/execution-sessions/:id/quality/progress` | 分批记录已领取结果，保持会话执行中 |
| `POST` | `/execution-sessions/:id/quality/complete` | 全部领取项有结果后结束会话并释放租约 |
| `POST` | `/execution-sessions/:id/quality/heartbeat` | 有效租约续期，不复活过期任务 |
| `POST` | `/execution-sessions/:id/quality/release` | 填写 `reason`，释放剩余范围并保留已有结果 |
| `POST` | `/execution-sessions/:id/quality/cancel` | 填写 `reason`；返回 `deviceStopped: false`，原设备仍需停止 |
| `POST` | `/quality/test-runs/:id/cases/:caseId/bug` | `{ bugId }` 将失败或阻塞项关联本项目缺陷，不改原执行事实 |
| `POST` | `/quality/test-runs/:id/finish` | `{ revision, reason? }` 无有效租约时关闭；失败/阻塞也可结束 |
| `POST` | `/quality/test-runs/:id/local-launch` | `{ targetId, caseIds?, preferredIde? }` 一次性短期交接票据 |
| `POST` | `/quality/local-launch/redeem` | 票据与 `deviceId` 换取绑定原用户/组织/任务的本地交接 |
| `POST` | `/quality/test-runs/:id/reports` | `{ idempotencyKey, mode: PROGRESS / FINAL }` 轮次报告 |
| `GET` / `POST` | `/quality/test-requests/:id/reports` | 不可变报告历史 / 按选定轮次、基线及替代范围生成汇总 |

`QualityExecutionReport` 继承旧冒烟结果结构，额外要求领取时的 `testRunRevision`。版本号在会话领取时冻结，不随后续批次或续租改变；`sourceFingerprint` 和实际 `testedRevisions` 必须与领取范围一致。进度事件以会话和 `idempotencyKey` 唯一；同键同内容返回原响应，同键异内容返回 409。只允许原领取人、当前组织、有效租约及领取范围，证据必须已上传完成且属于该执行会话。拒绝时整批不写入。结果更正使用新轮次，同轮复测保留严重结论。

正式轮次使用 `executionMode=LOCAL`、会话 `purpose=QUALITY_TEST`；旧轮次默认 `MANUAL`，旧 `LOCAL_SMOKE` 和会话语义保留。旧冒烟完成入口在写入前拒绝正式质量会话，人工结果入口也不能覆盖本地轮次。

## 报告、基线与状态

报告使用 `QualityTestReport` 及独立 Artifact 固定结果截止点。`PROGRESS` 标为未完成；`FINAL` 要求选中轮次已结束且没有有效执行租约。关闭轮次不要求通过：失败为 `FAILED`，未测、阻塞或跳过导致 `BLOCKED`。完成率、通过率均以应测的快照与目标端组合为分母；未测不算通过，零范围返回不适用比例并阻塞。任务汇总从全部冻结功能快照补齐漏测范围；已确认适用端逐端计数，未确认适用端且尚无映射时保留一项待确认的未测范围，HTML 报告列出遗漏明细。生成报告不隐式结束轮次。

任务汇总 POST 还需 `runIds`、`baseline: { workflowRepositoryId, branch, headSha }[]` 和可选 `supersessions: { previousRunId, regressionRunId, testRunCaseIds }[]`。仓库身份按真实 `repositoryId` 对齐。只有明确关联同一缺陷、修复已完成、匹配快照与目标端的独立终态回归才可替代原失败或阻塞行。允许多次修复形成明确无环回归链，也允许最终回归显式替代同一缺陷的多次历史失败；循环及同一原始结果重复替代被拒绝。已替代历史版本只作为历史事实列示，所有未替代有效行必须符合当前基线；同范围冲突阻塞，不能取最后一个通过结果。其他旧版本通过项需要在新版本重测，不能随一个 Bug 回归自动变成当前版本通过。

存在活动正式轮次时提测保持 `IN_TEST`。无活动轮次时保守聚合；只有覆盖全部正式轮次且业务事实未变化的显式汇总可用于更新整个提测结论，未覆盖功能快照、混合未知基线或冲突版本不会宣称通过。局部报告不会撤销事实仍适用的完整回归结论。冒烟门禁不决定正式测试是否通过。

报告包含需求、验收覆盖依据、统计口径、基线、执行人、环境、逐例实际结果、缺陷及证据引用。HTML 对动态内容转义，环境仅展示允许字段且移除 URL 凭据和查询串。查看/下载使用现有 Artifact 身份鉴权，历史内容不覆盖。

## 本地适配与兼容

适配结论：**需要适配**。Web、API、Prisma、`@flowx-ai/protocol`、`flowx-local`、MCP、IDE Adapter 和技能模板在本次变更同步交付；CLI 复用 `serve`、`login`、`sync` 和 IDE 启动路径，无需新增独立测试命令。工具清单及操作见本地 Agent 指南。服务端与本地包需支持 `case-selection`、`local-test-runs`、`quality-progress`、`test-reports`；旧服务端明确报能力不支持，不能静默丢字段或退回冒烟。

升级后重载 IDE 的 FlowX MCP 和技能。旧四个冒烟工具、冒烟完成请求和旧人工轮次保留；无需把旧历史数据伪装成本地新轮次。迁移新增 nullable 范围/适用端，旧 `TestRun` 默认为 `MANUAL`、`revision=0`。源码验证与 npm 发布是独立操作，本次不执行发布。
