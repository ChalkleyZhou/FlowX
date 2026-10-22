# 工作流接续与端云多人协同实施计划

> 执行方式：使用 superpowers:subagent-driven-development 分解独立任务；使用 superpowers:test-driven-development 先验证失败，再实现。最终统一进行规格审查与代码质量审查。

**目标：** 实施用户已确认的工作流协同方案，覆盖接续、端云状态、归属与换人恢复及提测可靠性。

**架构：** 复用 WorkflowRun、StageExecution、ExecutionSession、SyncEvent 和既有冒烟租约。只增加纯读取的协同摘要与显式结束旧任务接口；服务器决定本地动作，客户端展示当前任务，不复制权限或状态机。

**技术：** NestJS、Prisma/SQLite、React、Vitest。

## 1. 提测详情可靠性

- [x] 为真实 `LocalSmokeController` HTTP 响应补充无报告 JSON null、报告对象与不存在 404 的回归测试；先运行并确认无报告失败。
- [x] 为 `QualityRequestDetailPage` 补报告/轮次失败保留基本详情、主请求失败可重试、旧请求不能覆盖新路由的测试。
- [x] Controller 显式序列化 null；页面分开加载基本信息、轮次与报告，并展示对应错误/重试。`api.ts` 的错误保留 HTTP status，支持区分 403/404 与加载失败。
- [x] 运行 `pnpm --filter flowx-api test src/quality` 与 `pnpm --filter flowx-web test src/api.test.ts src/pages/quality/QualityPages.test.tsx`。

## 2. 需求接续入口

- [x] 为 `RequirementDetailPage` 增加单条/多条活跃流程、历史流程、无流程与请求失败的回归测试。
- [x] 直接展示当前流程与仓库范围；多条流程不静默选择；启动操作复用需求列表既有仓库/执行器选择，不从详情直接创建默认流程。
- [x] 在 `RequirementsPage` 启动弹框显示占用范围；保留不重叠并行能力。
- [x] 运行对应 Web 页面测试。

## 3. 领取与回传归属

- [x] 在 `workflow-local-design.spec.ts`、`workflow-local-spec-plan.spec.ts`、`local-smoke.service.spec.ts` 增加他人领取/回传、未记录归属、原执行人重试的失败测试。
- [x] 新增 `workflow-local-ownership.ts` 统一组织/用户校验；对构思、设计、方案 handoff 及完成入口执行校验，Controller 和 Edge Service 传入真实用户上下文。
- [x] 事务内锁定工作流版本再领取；将并发/唯一键冲突转成明确业务冲突。真实 SQLite 同时领取只允许一份有效会话。
- [x] 本地当前位置查询读取有效会话和身份；他人占用返回 `none`，消息明确等待执行人，保留已提交上游上下文。

## 4. 协同状态与重新交接

- [x] 新建 `workflow-collaboration.service.ts` 与 Controller/测试，提供纯读取 `GET /workflow-runs/:id/collaboration`。
- [x] 摘要返回各最新阶段的会话、执行人、健康度、最近回报和释放权限。复用 `getExecutionHealth`；领取时写入的时间不证明本地已运行。
- [x] 增加 `POST /workflow-runs/:id/local-task/release`：参数 `{executionSessionId, confirmedStopped: true, reason}`。仅本地构思/设计/方案的原执行人或组织管理员，事务核对阶段与会话仍有效，取消会话并标记当前阶段失败，追加操作审计。协作式开发继续走原停止回执。
- [x] 覆盖无权限、跨组织、旧阶段、并发回传、重复释放及晚到旧结果拒绝；不改 Prisma schema。

## 5. 当前任务前置

- [x] 新建 `WorkflowCollaborationPanel` 与测试；在工作流标题后展示服务器当前任务、确认后去向与纯读取的会话状态。
- [x] 实现显式结束旧任务的确认表单，说明必须先在原设备停止，填写原因后才能释放。
- [x] `WorkflowRunDetailPage` 将当前产物与阶段操作前置，背景、分支、统计、质量入口移至辅助区域；保留历史阶段查看，当前任务不随之改变。
- [x] 修正统计说明、设计 Markdown、产物摘要与下一阶段文案。异步刷新保留内容、避免重叠与路由串数据，终态停止轮询。

## 6. 集成、文档与交付

- [x] 更新 README、用户手册/本地指南及 Web 镜像、system-design 与质量/协同契约；更新 CHANGELOG。
- [x] 执行 `pnpm check`，有失败则定位并修复；执行两个手册 `cmp` 与 `git diff --check`。
- [x] 在隔离测试数据库中通过真实 HTTP/SQLite 验证领取竞争、原执行人回传与明确释放后换人；本地浏览器验证接续、状态和提测恢复，保存截图。
- [x] 对照已确认设计的 9 个验收场景进行证据审查，再进行独立代码质量审查。任何未覆盖的真实 IDE/跨设备环节如实记录，不以测试替代。
