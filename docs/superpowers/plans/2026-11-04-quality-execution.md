# 测试与质量模块实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `superpowers:executing-plans` 在当前会话按任务执行，逐阶段检查；只有用户明确选择代理协作时才使用 `superpowers:subagent-driven-development`。使用复选框记录真实完成情况。

**Goal:** 打通需求选例、完整功能测试与回归的本地执行、逐例回传和测试报告，兼容现有冒烟。

**Architecture:** 复用质量域的数据模型、执行会话、Artifact 和本地服务。API 统一控制权限、快照、领取、版本、结果和报告，Web 与 MCP 共享业务契约；旧冒烟入口保留原行为，新入口通过通用质量服务实现。

**Tech Stack:** NestJS、Prisma/SQLite、React、TypeScript、Vitest、`@flowx-ai/local`、`@flowx-ai/protocol`。

**设计依据：** `docs/superpowers/specs/2026-11-04-quality-execution-design.md`。本计划是尚未执行的代码实施安排，文中的新增文件、接口与工具均为目标契约。

---

## 执行约束与阶段边界

- 开始代码实施前读取目标目录 `AGENTS.md`，检查 `git status --short`。代码实施使用隔离 worktree，保留当前工作区已有改动；本次纯设计文档整理不创建额外 worktree。
- 高风险改动执行“先失败测试 → 最小实现 → 定向测试 → 子项目检查”。不要把断言依赖的固定成功 mock 当作端云适配证据。
- 每次提交只暂存本任务文件，并同步更新 `CHANGELOG.md`；禁止提交本地数据库、`.flowx-data`、凭据和生成物。
- 阶段 A 交付平台入口和明确选例；阶段 B 交付完整本地执行；阶段 C 交付报告及回归闭环。阶段 A/B 不能宣称全链路已完成。
- 所有复选框初始未完成，只有相应验证真实通过后才能勾选。实施期间发生范围变化，应同步更新本计划和设计中的受影响规则。

## 目录与职责

| 单元 | 文件 | 职责 |
| --- | --- | --- |
| 共享契约 | 新增 `packages/flowx-protocol/src/quality.ts` 及测试，修改 `src/index.ts` | 质量执行、进度、控制、报告的跨端类型和常量 |
| 数据模型 | `prisma/schema.prisma`、新增 migration | 选例范围、适用端、进度幂等记录、报告修订及引用关系 |
| 选例 | 新增 `apps/api/src/quality/test-case-selection.ts` 及测试，修改 `test-designs.service.ts`、DTO | 所选库权限、模块过滤、确定性检索与候选范围记录 |
| 通用本地执行 | 新增 `apps/api/src/quality/local-test-runs.service.ts`、`local-test-runs.controller.ts`、`dto/local-test-run.dto.ts` 及测试 | 通用创建、领取、进度、完成、控制，复用现有冒烟公共基础逻辑 |
| 执行公共基础 | 新增 `apps/api/src/quality/local-test-execution.ts` 及测试 | 版本解析、租约和结果校验，供新入口与冒烟适配调用 |
| 报告 | 新增 `test-reports.service.ts`、`test-reports.controller.ts`、`test-report-summary.ts`、`test-report.render.ts` 及测试 | 不依赖通过门禁的报告、不可变快照及多轮汇总 |
| 模块与组织隔离 | `apps/api/src/quality/quality.module.ts`、`apps/api/src/prisma/organization-scope.ts` 及测试 | 服务注册、新模型的组织范围隔离 |
| 任务发现与本地交接 | `apps/api/src/edge/edge-tasks.service.ts`、`apps/api/src/workflow/local-launch.service.ts` 及 Controller/测试 | 可执行质量任务查询、会话绑定的 IDE 交接 |
| 平台入口 | `apps/web/src/pages/RequirementDetailPage.tsx`、`apps/web/src/pages/quality/QualityDialogs.tsx` | 需求直达、连续步骤及前置条件修复入口 |
| 质量页面 | 新增 `QualityScopePanel.tsx`、`QualityRunDetailPage.tsx`、`QualityReportsPanel.tsx` 及测试 | 选例、逐例明细、证据、报告和回归 |
| 页面编排 | `QualityRequestDetailPage.tsx`、`QualityTestDesignPage.tsx`、`QualityRunsPage.tsx`、`apps/web/src/App.tsx` | 五个详情页签、执行详情路由、安静刷新 |
| Web 边界 | `apps/web/src/api.ts`、`apps/web/src/types.ts` 及测试 | 明确请求和响应类型、能力检测、错误处理 |
| 本地适配 | `packages/flowx-local/src/mcp.ts`、`user-mcp.ts`、`launch.ts`、`server.ts` 及测试 | 通用质量工具、任务发现、既有启动链路适配 |
| 操作说明 | 新增 `packages/flowx-local/templates/flowx-local-test/SKILL.md`，检查既有冒烟模板及 `setup.ts` | 明确功能测试与回归的领取、执行和回传步骤 |

不整体重写 `local-smoke.service.ts`。先以既有测试锁定其行为，只抽取新旧两条路径确实共用的逻辑；旧 `finalize` 仍负责提测前冒烟门禁。

## 目标契约

### 选例与快照

`CreateTestDesignDto` 增加可选 `caseSelection`：

```ts
export interface QualityCaseSelection {
  libraryIds: string[];
  moduleIds?: string[];
  priorities?: string[];
  tags?: string[];
  targetKeys?: string[];
}

export interface QualityRetrievalSummary {
  eligibleCount: number;
  matchedCount: number;
  suppliedCount: number;
  truncated: boolean;
}
```

规则：显式传入时 `libraryIds` 至少一项且全属于当前项目可用范围；模块必须来自所选库，父模块包含后代；其他筛选维度之间取交集。省略 `caseSelection` 保持旧客户端项目库加共享库的范围。新 Web 默认项目库，共享库需要用户选择。

库中所有候选先按需求覆盖关系、模块/标签匹配、优先级、ID 稳定排序，再限制 AI 输入数量，记录上述统计。手工选例使用同一权限过滤，不受 AI 输入数量限制。没有匹配结果时不自动扩大到未选库。

用例适用端使用 `targetKeys: string[]`；空数组表示“未确认”，不是“全部端”。新通用轮次要求显式的用例与目标端映射，旧冒烟端点保留原笛卡尔积语义。适用端、测试数据和选例依据一起进入快照。

### 通用本地执行 API

| 方法与路径 | 输入/结果 | 业务条件 |
| --- | --- | --- |
| `POST /quality/test-requests/:id/local-test-runs` | `name`、`runType: INITIAL / REGRESSION`、`sourceBugId?`、`targets`、`cases: { snapshotId, targetKeys }[]` | 范围就绪、研发完成；回归必须关联本项目且修复工作流已完成的 Bug |
| `GET /quality/test-runs/:id` | 快照、目标端、逐例结果、执行及证据引用 | 组织及项目可访问 |
| `GET /quality/test-runs/:id/tasks` | 待领取范围、占用、基线和进度 | 新旧轮次可读；老人工轮次明确不支持本地领取 |
| `POST /quality/test-runs/:id/claim` | 复用 `targetId`、`caseIds?`、`deviceId?`、`leaseSeconds?` | 仅活动轮次，原子领取；返回服务端分配的会话和范围 |
| `POST /execution-sessions/:id/quality/progress` | 稳定幂等键、基线、已完成用例、进度摘要 | 原领取人、有效租约、只写领取范围；不结束会话 |
| `POST /execution-sessions/:id/quality/complete` | 稳定幂等键、实际基线、最终结果与证据 | 与进度相同校验；已保存结果可复用，全部领取项有终态才完成 |
| `POST /execution-sessions/:id/quality/heartbeat` | 续租秒数 | 原领取人且未过期；原子同步 session、execution 与逐例 lease |
| `POST /execution-sessions/:id/quality/release` | 释放原因 | 原领取人；释放剩余项，保留已回传事实 |
| `POST /execution-sessions/:id/quality/cancel` | 取消原因 | 原领取人，或按既有管理员结束旧任务规则；服务端取消不表示设备进程已停止 |

通用入口复用现有身份、组织隔离和归属校验。会话 `metadata.purpose` 为 `QUALITY_TEST`，旧冒烟保持 `LOCAL_SMOKE`。轮次 `runType` 表达初测/回归，新增 `executionMode` 区分 `LOCAL` 与旧 `MANUAL`，避免为每个执行端复制测试类型。

### 结果与报告

新协议复用现有四种结果和仓库版本结构，不修改旧 `LocalSmokeCompletionReport`。`QualityExecutionReport` 新增 `testRunRevision`，并沿用 `idempotencyKey`、`sourceFingerprint`、`testedRevisions`、`caseResults`、`environment`、`artifactIds` 和 `summary`。

进度提交用独立事件表记录幂等键与 payload hash。同键同内容返回原接受结果，同键不同内容返回 409；分批请求在事务中写入事件、逐例事实和进度。最终完成只允许结果一致的重复项，结果更正通过新轮次记录。

报告 API：

- `POST /quality/test-runs/:id/reports`，输入 `idempotencyKey`、`mode: PROGRESS | FINAL`。`FINAL` 必须无有效执行租约，未测项保留为未测并使结论阻塞；生成报告不隐式结束轮次。
- `POST /quality/test-runs/:id/finish`，输入 `revision` 与结束原因，CAS 检查无有效执行，按已保存结果和未测项关闭轮次；不要求所有结果通过。
- `GET /quality/test-requests/:id/reports`，查询有权限的不可变历史报告。
- `POST /quality/test-requests/:id/reports`，输入 `idempotencyKey`、`mode`、`runIds`、`baseline` 和 `supersessions: { previousRunId, regressionRunId, testRunCaseIds }[]`，汇总指定轮次。

报告使用 `QualityTestReport` 保存 `requestId`、`runId?`、`kind`、`revision`、`idempotencyKey`、`payloadHash`、`sourceFingerprint`、`artifactId`、`snapshot`、`createdByUserId` 和时间；`(requestId, kind, revision)` 与 `(requestId, idempotencyKey)` 分别唯一。历史 Artifact 不改写，新报告固定引用的轮次、基线与结果截止点。

同一快照、目标端和基线的有效结果才可汇总。回归替代必须明确关联修复与被替代范围，且修复已完成；未列出的旧失败继续阻断。同一范围存在尚未裁定的冲突则标记阻塞，不能自行取最后结果。不同代码基线分别列示，不合并计算为当前版本覆盖。

## 阶段 A：平台交互与需求选例

### 任务 1：持久化选例范围、适用端和报告契约

**文件：** 共享协议与测试、`prisma/schema.prisma`、新增迁移、组织隔离与测试、`apps/web/src/types.ts`。

- [ ] 在协议测试增加真实序列化 fixture，验证新增结构能携带 `caseSelection`、`targetKeys`、结果和报告引用，且旧冒烟 fixture 不需要新字段。

```ts
const selection: QualityCaseSelection = {
  libraryIds: ['library-project'],
  moduleIds: ['module-auth'],
  targetKeys: ['web'],
};
expect(JSON.parse(JSON.stringify(selection))).toEqual(selection);
```

- [ ] 运行 `pnpm --filter @flowx-ai/protocol test`，确认新增导出缺失导致预期失败；实现协议定义及导出，再运行 test/build。
- [ ] Schema 为 `TestDesign` 增加可选选择范围与检索统计 JSON；用例定义和快照增加适用端 JSON；`TestRun` 增加 `executionMode`、`revision`；增加上述报告表与进度事件表。旧行分别保持旧范围、未配置适用端和 `MANUAL`，历史冒烟仍由 `runType` 识别。SQLite migration 使用兼容默认值，禁止回填虚构结果。
- [ ] 先补组织隔离测试，再把新模型的项目/工作区关系加入现有作用域机制。用临时 SQLite 执行 migration，验证旧数据可读、跨组织查询不可见；不使用开发数据库执行迁移验证。
- [ ] 运行 `pnpm prisma:generate`、protocol test/build、API 组织隔离定向测试。更新 `CHANGELOG.md` 后提交本任务。

### 任务 2：选定用例库、稳定检索与手工补选

**文件：** `test-case-selection.ts` 及测试、`test-designs.service.ts`/spec、`dto/test-design.dto.ts`/spec、`test-designs.controller.ts`/spec、`test-requests.service.ts`/spec、AI 测试设计 prompt/schema 与消费者。

- [ ] 补服务测试：选定项目库 A 后，即使共享库 B 的标题更匹配也不读取 B；跨项目库/错库模块/显式空库列表返回 400；省略范围保留旧库集合。构造 251 条用例，确保较早更新但关联需求的关键用例能入选。
- [ ] 补快照测试，断言 `testData`、来源版本、选择理由和 `targetKeys` 实际写入，不只在 DTO 接受。增加人工纳入未进入 AI 上下文的第 251 条用例的用例。
- [ ] 运行 `pnpm --filter flowx-api test -- src/quality/test-designs.service.spec.ts src/quality/test-requests.service.spec.ts`，确认对应测试失败。
- [ ] 在独立选择器完成授权过滤、模块后代展开和稳定排序，AI 服务只消费选择器结果。记录候选数和截断信息；prompt/schema 明确完整结果字段，契约变化同步 parser/executor 测试。人工纳入调用现有范围写入能力，必要时增加测试设计候选新增 API，使确认前后都能保留人工来源和覆盖依据。
- [ ] 定向测试通过后运行完整 API 测试，更新变更记录后提交。验收需同时看到所选库 ID 和实际查询条件，避免只测参数保存。

### 任务 3：需求入口、连续准备和选例界面

**文件：** `RequirementDetailPage.tsx`/test、`QualityDialogs.tsx`、`QualityTestDesignPage.tsx`/test、新增 `QualityScopePanel.tsx`/test、`QualityRequestDetailPage.tsx`、`QualityPages.test.tsx`、Web API/types 及测试。

- [ ] 使用现有 React `act`/DOM 测试方式，补用户路径：需求入口带入项目版本和需求；已有设计优先进入，创建时不会重复；项目切换后清除旧库与旧选择；缺少已确认设计提供可点击的创建/修复入口。
- [ ] 为选例界面补测试：模块筛选、人工纳入、批量排除、原用例与建议差异、截断提示、未覆盖验收点。确认请求断言实际包含所选库和用例 ID，不能只断言按钮可点。
- [ ] 运行 `pnpm --filter flowx-web test -- src/pages/quality/QualityPages.test.tsx src/pages/quality/QualityTestDesignPage.test.tsx src/pages/RequirementDetailPage.test.tsx`，确认新行为测试失败。
- [ ] 复用现有 UI 组件实现需求驱动的连续准备步骤及左库/中列表/右摘要。详情以 URL 查询参数 `tab` 保留五个页签，旧链接默认概览。后台刷新采用显式 `{ silent: true }`，保持数据和滚动状态；异步请求用序列或取消机制隔离旧响应。
- [ ] Web 测试与 build 通过后，用浏览器检查桌面和窄屏、键盘操作、空/错/加载状态。阶段 A 文档明确“功能测试本地执行与综合报告尚未交付”，同步手册与变更记录后提交。

## 阶段 B：通用本地执行与逐例回传

### 任务 4：通用轮次、适用端矩阵和原子领取

**文件：** 新增本地测试 DTO/Controller/Service 及 spec、`local-test-execution.ts`、既有 `local-smoke.service.ts`/spec、`test-runs.service.ts`/spec、`quality.module.ts`。

- [ ] 补服务和 HTTP 测试：功能快照可进入新入口；相同快照只进入显式指定目标端；快照不属于计划、目标端不存在、无适用端映射、跨项目 Bug、修复未完成均拒绝。
- [ ] 在临时数据库以两个真实并发领取请求验证最多一个成功、另一个 409；验证租约内同用例不可再领、不同用例可并行，过期后重新领取产生新会话。
- [ ] 运行新 spec，确认新入口不存在或行为未实现导致失败。
- [ ] 通用服务按目标契约创建 `INITIAL`/`REGRESSION` 本地轮次。抽取既有版本解析、领取事务及归属校验，由旧冒烟服务适配调用；新旧状态前置条件在各自业务入口校验。旧人工 `reportResult` 对 `LOCAL` 模式拒绝，防止绕过租约和会话写入。
- [ ] 运行 API 全部 quality 测试、`workflow-code-delivery.integration.spec.ts` 和原归属测试；新旧请求均通过后更新变更记录并提交。

### 任务 5：分批结果、续租、释放和取消

**文件：** 通用本地测试 DTO/Service/HTTP spec、进度事件 schema、`apps/api/src/execution-sessions/execution-sessions.service.ts`/spec、既有 `workflow-local-ownership` 与 Artifact 服务测试。

- [ ] 编写数据驱动测试，至少覆盖下表，每条通过真实事务或 HTTP 校验确认状态与数据库事实。

| 请求 | 预期 |
| --- | --- |
| 首次 progress 提交已领取 case-1 | 200，保存结果，会话仍 RUNNING |
| 同幂等键、相同 payload 重试 | 200，不重复记录，不改变原时间 |
| 同幂等键、改变 case-1 结论 | 409，不覆盖事实 |
| progress 提交未领取 case-2 | 400，整批不写入 |
| 非原领取人/跨组织/租约过期 | 403 或领域冲突，所有结果不写入 |
| 跨任务证据或尚未上传成功的 ID | 拒绝，不建立非法关联 |
| heartbeat 与过期后重新领取并发 | 只有符合当前租约所有者的操作成功 |
| release 后旧会话 complete | 冲突；已接受结果仍可查询 |
| cancel 后旧设备晚到结果 | 冲突，不影响新会话 |
| complete 时尚有领取项未报结果 | 400，并返回缺失项 |

- [ ] 运行定向测试确认失败，再实现幂等事件写入、逐例事实、聚合和租约更新的事务；校验顺序为身份/范围/租约/基线/结果/证据，保证拒绝路径无部分写入。
- [ ] 分批完成保存不可变结果；`complete` 校验所有领取项已有终态结果，CAS 结束会话并释放租约。失败用例仍可完成执行会话，执行成功与测试通过分别表达。
- [ ] 续租更新 `TestExecution`、`TestRunCaseLease` 和会话活动时间，无法复活过期租约；取消需记录原因与操作者，页面说明设备停止状态，复用已有管理员结束旧任务边界。
- [ ] API 全部测试通过后提交，变更记录明确旧冒烟完成请求和旧人工录入行为的兼容结果。

### 任务 6：本地任务发现、MCP 和 IDE 交接

**文件：** `edge-tasks.service.ts`/spec、`local-launch.service.ts`/spec 及 Controller、`packages/flowx-local/src/mcp.ts`/test、`user-mcp.ts`/test、`launch.ts`/test、`server.ts`/test、`setup.ts`/test、新测试 Skill 模板、protocol 能力契约。

- [ ] 先补工具发现测试，确认旧四个 smoke 工具保持 schema 和路径；通用任务查询可返回质量任务且按用户、项目和版本过滤，权限不足的任务不可见。
- [ ] 按目标 API 提供 `flowx_create_test_run`、`flowx_list_test_tasks`、`flowx_claim_test_task`、`flowx_report_test_progress`、`flowx_submit_test_report`、`flowx_control_test_execution`。最后一个工具使用 action 枚举 `heartbeat/release/cancel` 映射到对应服务端端点；不在 MCP 判断业务状态。
- [ ] 工具调用测试逐项断言路径、方法和 JSON 字段，特别检查 `runType`、`sourceBugId`、`targetKeys`、`testRunRevision`、幂等键与证据。调用未知能力时返回明确不支持错误，禁止静默退回 smoke 工具。
- [ ] IDE 交接通过现有短期 ticket 与设备身份流程增加质量任务 purpose；本地完成仓库映射、代码基线检查后绑定服务端领取范围。覆盖启动失败、用户取消和领取后的交接失败，释放未开始的范围；不把“IDE 已打开”写成“用例执行成功”。
- [ ] 新 Skill 明确先查询/领取，再真实执行、上传证据、分批回报和完成；不把生成脚本视为执行。模板安装时保留用户其他 MCP/Skill，旧冒烟模板继续只做冒烟。
- [ ] 运行 local test/build、protocol test/build，以及 API 任务和交接相关测试。使用 MCP client 连接真实工具实例检查 discovery 与调用，再通过临时 HTTP 服务执行至少一次真实成功和失败回传。同步本地指南、安装说明和变更记录后提交。

### 任务 7：平台执行详情与本地启动体验

**文件：** 新增 `QualityRunDetailPage.tsx`/test，修改质量详情和执行记录列表、`apps/web/src/App.tsx`/test、Web API/types、既有本地 bridge 与启动引导组件及测试。

- [ ] 补页面测试：执行列表标题链接到 `/quality/test-runs/:id`；轮次详情展示逐例实际结果、证据、环境和版本；切换项目/轮次后旧请求不覆盖新数据。
- [ ] 补本地启动测试：未安装、未登录、无仓库映射、代码不匹配分别出现对应可执行引导；启动成功显示等待实际进度，收到服务端进度后才展示执行中。
- [ ] 新详情页按目标端和结果筛选，突出失败、阻塞、待执行、待回传；以原用户权限预览 Artifact。支持领取范围查看、续租状态、释放和取消，取消设备任务按已有停止协议显示真实状态。
- [ ] 使用受控轮询并在 effect 清理定时器；保证无重叠请求、首屏错误可重试、后台失败不重复 toast、终态停止轮询。增加 fake timer 与延迟响应测试。
- [ ] 运行 Web 全部 test/build，浏览器验证真实本地 bridge 的成功与失败引导；更新阶段 B 文档和变更记录后提交，明确综合报告仍待阶段 C。

## 阶段 C：测试报告与缺陷回归闭环

### 任务 8：独立报告、失败轮次关闭与不可变产物

**文件：** 新增报告 DTO/Controller/Service、`test-report-summary.ts`、`test-report.render.ts` 及 spec/HTTP/integration spec，修改质量模块、Artifact 关联和通用轮次服务。

- [ ] 在 `test-report-summary.spec.ts` 建立统计输入和精确结果断言；每项用例代表一个适用的“快照×目标端”组合。

```ts
const results = ['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED', null] as const;
expect(summarizeQualityResults(results)).toEqual({
  total: 5, passed: 1, failed: 1, blocked: 1, skipped: 1, pending: 1,
  completionRate: 0.8, passRate: 0.2, conclusion: 'FAILED',
});
expect(summarizeQualityResults([])).toMatchObject({
  total: 0, completionRate: null, passRate: null, conclusion: 'BLOCKED',
});
```

- [ ] 实现该纯函数并直接供渲染器和服务使用：优先级为存在失败 → FAILED，否则存在阻塞/跳过/未测/零范围 → BLOCKED，否则 PASSED。返回比例而非格式化百分数字符串，由展示层格式化。
- [ ] 补 HTTP 测试：失败轮次 `PROGRESS` 报告可生成；未结束执行的 `FINAL` 返回冲突；无租约但未测完可显式 `finish` 为 BLOCKED；报告生成不会把任务改成 PASSED，结束轮次不覆盖并行轮次状态。
- [ ] 事务内固定结果数据和轮次 revision，再生成 Artifact 并关联报告记录；通过 CAS 防止生成期间结果变化导致错误归档，失败清理未关联产物。相同幂等键重复请求返回原报告，payload 变化冲突，历史 snapshot/Artifact 保持不变。
- [ ] 报告 HTML 复用转义规则，展示需求、基线、统计口径、未测项、缺陷与证据入口；避免直接输出凭据或执行环境中的敏感字段。环境字段使用明确允许展示的键，证据链接经权限 API 访问。
- [ ] 运行 API 报告、Artifact、quality 全部测试，更新变更记录后提交；旧 `submission-report` 和 smoke `finalize` 的 fixture 均保持通过。

### 任务 9：多轮汇总、回归替代和统一状态聚合

**文件：** 报告 summary/service 及测试、`test-runs.service.ts`/spec、`quality-status.ts`/spec、通用本地测试服务、新增 `test-request-summary.ts`/spec。

- [ ] 先补五类汇总测试：初测失败且未回归仍失败；合法回归替代后保留历史失败但当前结论可通过；不相关 Bug 回归不能替代；不同代码基线不能合并宣称已测；两个同基线冲突结果未显式处理时阻塞。
- [ ] 对 `supersessions` 验证当前请求归属、回归源 Bug、完成的修复工作流、替代范围和基线。报告 snapshot 保存有效结果清单与替代关系，提供从汇总结论追溯到每次执行的引用。
- [ ] 统一普通人工结果、本地执行完成、回归和轮次关闭后的任务聚合：存在活动正式轮次保持 IN_TEST；无活动正式轮次时按当前有效范围汇总；冒烟门禁不直接决定正式测试 PASSED。所有状态变化使用现有状态转换约束。
- [ ] 补并发测试：两个轮次同时完成只产生正确有效范围结论；生成报告期间回传或结束新轮次不会修改旧报告。运行定向测试和 API 全部测试。
- [ ] 同步技术设计、接口文档与变更记录，提交本任务。禁止以最后完成的一个轮次直接覆盖整个提测状态。

### 任务 10：报告页、失败项回归与完整验收

**文件：** 新增 `QualityReportsPanel.tsx`/test，修改质量详情、轮次详情、Web API/types/test、缺陷相关复用组件；更新 README、质量专题、系统设计、用户和本地指南及镜像。

- [ ] 补 Web 测试：失败也可生成报告；阶段报告标记未完成；报告列表显示类型、版本、基线和时间；旧版报告仍可查看；无报告接口返回 JSON null 或空列表而非空 HTTP 响应。
- [ ] 失败项支持关联已有 Bug/显式创建 Bug，修复未完成时说明回归前置条件；完成后创建新回归轮次并默认带入失败项。测试断言新轮次 ID 和初测历史都保留。
- [ ] 报告页提供在线查看、HTML 下载、轮次选择与当前基线汇总；证据预览复用现有组件，不另造公开下载入口。任务与轮次报告使用不同类型标识，旧冒烟提测报告继续单独标为冒烟门禁报告。
- [ ] 执行真实闭环：从需求选库选例，在本地分别产生通过、失败、阻塞和跳过结果，分批回传并重试，生成失败报告，完成修复后回归，再生成汇总报告。核对数据库事实、API 返回、页面与下载内容一致；真实设备未覆盖的 iOS/Android 明确记录，不以 Web/API 结果代替。
- [ ] 更新所有用户可见文档和镜像；运行下方全部交付检查。检查通过后更新 `CHANGELOG.md`、提交并给出本地适配、兼容结果及未验证环境。

## 最终验证命令与交付证据

按依赖顺序执行，每条必须实际读取退出码和失败明细；这些命令是实施时要求，不表示本次设计整理已运行代码测试。

```bash
pnpm prisma:generate
pnpm --filter @flowx-ai/protocol test
pnpm --filter @flowx-ai/protocol build
pnpm --filter @flowx-ai/local test
pnpm --filter @flowx-ai/local build
pnpm --filter flowx-api test
pnpm --filter flowx-web test
pnpm --filter flowx-web build
pnpm check
git diff --check
cmp -s docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
```

预期：全部退出 0，所有必需测试通过；MCP discovery、真实工具请求到 HTTP 契约、并发领取、晚到结果拒绝和完整回归报告均有执行证据。只通过类型检查、组件 mock 或旧 smoke 测试不能标记通用本地执行完成。

最终交付说明记录：本地适配结论为“需要适配”；列出实际新增/复用入口、旧包行为、升级及 MCP 重载方式、执行命令和结果、未验证平台、文档镜像一致性。没有执行的阶段继续保持未完成，不能随设计文档提交而勾选。
