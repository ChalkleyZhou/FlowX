# 并行开发进展总览实施计划

**目标：** 将 Agent 运行入口调整为进入系统后的默认 Dashboard 看板，以查看并行开发整体情况和需关注事项为主，支持项目、执行人、工具、状态、需求搜索和每页 20 条的页码分页。

**方案：** 复用 ExecutionSession、execution.progressed 和 Evidence，不新增数据库字段、不将心跳解释为开发进度。保留旧游标 API；新增 page 模式返回总条数和页码，在服务端完成筛选和异常优先排序。列表及独立详情用于查看，现有工作流控制能力保留。

**技术栈：** NestJS、Prisma、React、TypeScript、Vitest。

## 1. API 契约与分页

- [x] 先扩展 execution-control.service.spec.ts 及真实临时 SQLite 集成测试，覆盖组织隔离、需求搜索、执行人、四种视图、全局异常置顶、跨页和越界页归位。
- [x] 扩展 ListExecutionSessionsDto：page、view（active/attention/completed/all）、claimedByUserId、search；沿用 take 作为每页大小，page 与 cursor 互斥。
- [x] 在 ExecutionControlService 实现页码模式：只聚合本地 EXECUTION，会话与总数在同一事务读取；attention 条件和健康状态使用同一超时常量。旧游标请求保持兼容。
- [x] 列表返回项目、阶段状态摘要、最近 execution.progressed 事件及最近测试/Agent 摘要证据，避免逐条请求。

## 2. 页面

- [x] 先补充 ExecutionSessionsPage.test.tsx 和 api.test.ts：默认进行中、搜索/筛选重置页码、翻页及详情返回保留 URL、静默刷新保留内容、真实进度及缺失回报提示、详情只读。
- [x] 同步 types.ts 和 api.ts 的分页契约；将列表行拆为独立查看组件，展示需求、项目、执行人、Agent、阶段、进展、原因、耗时、最近回报和测试证据。
- [x] 将标题及导航改为开发进展；增加快捷视图、执行人和搜索，复用项目/状态/工具筛选。页码分页每页 20 条，显示总数、相邻页及首尾页。
- [x] 后台每 30 秒静默刷新，不清空内容、不隐藏已有数据；筛选变化回首页，刷新与详情返回保持筛选及页码。

## 3. 文档与验证

- [x] 同步 README.md、docs/system-design.md、docs/user-manual.md 和 apps/web/public/user-manual.md，说明视图、筛选、分页、进度来源与未知状态。
- [x] 运行受影响 API/Web 测试确认失败后修复，再运行 pnpm check、git diff --check 和两组手册 cmp。
- [x] 核对完整 diff，记录测试结果及限制；保持代码可审阅，不自动提交或推送。

## 4. 核实后补齐本地进度入口

- [x] 原 MCP 检查点只有心跳和阻塞原因，无法回报具体进展；增加可选 `progressSummary`，API 在同一事务写摘要和进度事件。
- [x] 真实 SQLite 回归覆盖摘要重试幂等、空白拒绝、终态与待停止保护；MCP 测试覆盖参数透传。
- [x] 同步随包发布的执行和继续技能模板，明确实质进展携带摘要、普通保活省略。旧模板应用测试只有会话 ID，新模板应用测试验证具体摘要回传。
- [x] 同步本地 Agent 指南、运维说明和镜像，说明新版客户端/技能要求以及回报不进入 Outbox。

## 5. 默认 Dashboard（用户后续确认）

- [x] API 的页码模式补充 `counts`，按项目、执行人、工具、搜索等公共条件统计 active/attention/completed/all，忽略当前页、视图和精确状态；概览不能用当前页的记录数计算。
- [x] 顶部四张可点击概览卡切换任务范围，下方使用响应式进展卡片网格；保留筛选、搜索和每页 20 条分页，保持异常优先和静默刷新。
- [x] 增加 `/dashboard` 为规范入口，根路由和普通登录后默认到看板；旧 `/execution-sessions` 链接带原查询条件重定向，看板置于侧栏首项，详情返回看板。
- [x] 登录保护保留原目标的路径、查询和片段；不覆盖用户从需求或工作流链接登录的目标。
- [x] 先补聚合统计、首页/旧链接路由、筛选页码和登录目标测试，再实现。同步 README、系统设计和手册，运行全仓检查及浏览器布局检查。

## 第一轮验证结果（Dashboard 调整前）

- `npm_config_workspace_concurrency=1 pnpm check` 通过：API 721、Web 183、本地包 163、Cursor Extension 78、协议包 13，共 1158 项测试；全仓构建通过。默认并发首次触发本地 Git 测试 5 秒超时，按 workspace 串行复测后通过，未调整测试超时或业务逻辑。
- `pnpm --filter @flowx-ai/local build` 通过。
- `git diff --check` 和两组手册镜像 `cmp` 通过。
- 独立代码审查发现的详情进度截断、测试证据挤占和项目关联缺失均补充回归并修复，复核无新增 P1/P2。
- 本地执行模板的基线/更新后应用测试通过；未进行浏览器实机交互检查。
- 改动保留在 `codex/development-progress`，未提交或推送；进度摘要需要新版客户端与重新加载的 MCP/执行技能。

## Dashboard 调整验证结果

- `npm_config_workspace_concurrency=1 pnpm check` 通过：API 721、Web 189、本地包 163、Cursor Extension 78、协议包 13，共 1164 项测试；API/Web/协议构建通过。
- 独立复核概览统计作用域、组织隔离、筛选分页、默认首页、登录目标及旧链接兼容，未发现 P1/P2。
- 浏览器使用隔离的临时示例接口验证首页重定向、概览切换、第二页、详情返回和旧入口查询/片段保留；1280px、1600px 和 390px 布局检查通过，宽窄屏无横向溢出。未使用生产数据或验证真实 IDE 会话。
- README、系统设计和两组手册源/镜像已同步；文档一致性与空白检查通过。
- 保留当前分支的未提交改动，未提交、推送或部署。
