# FlowX 本地体验验证记录

验证日期：2026-10-22。关联评估：[产品经理视角体验评估](product-experience-review-2026-10-21.md)。本轮目标是启动本地服务，并核对登录后的需求、设计工作流和质量入口。

## 环境与数据边界

- Web：`http://127.0.0.1:4173/`；API：`http://127.0.0.1:3000/`，Web 通过 `/api` 代理访问。
- 使用原 `dev-current.db` 的 SQLite backup 副本验证；原库和 `.env` 未修改。副本存放于系统临时目录 `flowx-validation-20261022-shrvcw0e/validation.db`。
- 旧库缺少当前质量模块表，且 Workspace 缺少组织关联。仅在副本执行既有 `20260826160000_add_workspace_organization` 迁移，再同步当前 Prisma schema；这不构成正式升级流程验证。
- 本地 API 关闭简报和每日代码审查定时器，使用 `HOST=127.0.0.1`。
- 用户通过正常登录流程登录；未读取或导出登录凭据。
- 页面操作未提交新需求、提测或工作流，也未确认、驳回已有阶段。原有未跟踪文档保持不变。

## 页面实测

| 页面/路径 | 已观察结果 | 判断与限制 |
| --- | --- | --- |
| 看板 | 进行中、需关注、已完成均为 0；工作流列表却有 1 条待处理流程 | 看板仅统计本地开发执行，不能充当产品待办入口；这是覆盖范围差异 |
| 需求列表 | 「增加全局通知」显示 1 条活跃流，范围为 r2crm | 列表能找到当前流程 |
| 需求详情 `/requirements/cmrvung4p000120gmyngq4bdg` | 主操作仍为「启动研发工作流」，缺少继续现有流程的入口 | 线上报告中的衔接问题在本地仍可观察 |
| 工作流 `/workflow-runs/cmrvunn5q000520gmdycme8ua` | 先展示统计、需求全文、尚不可用的用例/提测操作，再展示设计阶段 | 当前阶段内容仍出现较晚 |
| 同一工作流 | 「代码上下文 1」搭配「当前还没有沉淀的审查条目」 | 辅助说明与统计对象不一致 |
| 同一工作流 | 当前设计状态为「本地 OpenDesign 设计中」，第 2 次执行暂无产物；顶部提示「当前有阶段正在后台执行」 | 数据库中确有旧 `RUNNING` 记录，不能据此证明本机有对应设计任务运行。此记录不能用于验证线上「已有设计稿却显示暂无输出」问题 |
| 提测管理 | 列表正常加载，0 条记录；发起提测表单可打开、取消 | 缺少已完成工作流与已确认测试设计，未创建草稿，无法复现原线上记录的详情页 |
| 用例库 | 工作区加载后「新建用例库」可用；其余操作依赖用例库数据 | 初始加载时禁用不属于永久故障；当前无用例数据 |

检查期间浏览器未捕获到 warn/error 日志。该结果仅覆盖本轮已访问页面。

API 日志另有钉钉组织范围查询 `DINGTALK_SCOPED_ORGS_REQUEST_FAILED` HTTP 404 警告；用户登录及上述页面访问已成功，但本轮没有验证该外部接口与组织同步行为。

## 提测详情空响应问题：已确认的失败路径

使用当前已构建的真实 `LocalSmokeService.latestReport` 和 `LocalSmokeController` 启动隔离 Nest 应用，监听随机 loopback 端口。仅 Prisma 查询替换为合成 fixture，不连接业务数据库，不涉及现有服务的认证设置。

合成条件为「提测存在，但没有可用报告」，即查询返回 `{ id, artifactLinks: [] }`。实验结果：

```text
Service.latestReport 返回 null
GET /quality/test-requests/existing-without-report/submission-report
HTTP 200
Content-Type: 未设置
响应体: 0 bytes
JSON.parse: Unexpected end of JSON input
Promise.all 失败后，提测页面 request 状态仍为 null
```

另以不存在的提测作为对照，真实 Service/Controller 返回 HTTP 404。上述断言全部通过，隔离应用已关闭。

对应代码路径：

1. `apps/api/src/quality/local-smoke.service.ts` 的 `latestReport` 在无报告时返回 `null`，这是当前业务方法允许的结果。
2. `apps/api/src/quality/local-smoke.controller.ts` 直接返回该值，Nest 将其写为 HTTP 200 空响应。
3. `apps/web/src/api.ts` 的通用请求函数对成功响应始终调用 `response.json()`，因此空响应导致解析失败。
4. `apps/web/src/pages/quality/QualityRequestDetailPage.tsx` 通过 `Promise.all` 同时获取详情、轮次和报告，全部成功后才设置提测数据。报告解析失败使基本详情也无法显示，最终误显示「提测不存在」。

这确认了一条能够导致线上所见症状的代码失败路径；本轮未取得原线上记录的失败 HTTP 响应，不能把该实验等同于原记录的端到端复现。

修复建议：明确无报告的 HTTP 契约并覆盖真实响应解析；将提测基本信息与次要报告的错误状态分开，区分加载失败、无权限、真实不存在。当前页面测试 mock 直接返回 `null`，不会经过 HTTP 空响应，因此测试通过也无法排除此问题。

## 验证命令与结果

- Web 根页面 HTTP 200；`/api/auth/providers` 代理 HTTP 200。
- 执行以下相关测试，3 个文件、52 项测试全部通过：

```bash
pnpm --filter flowx-web test \
  src/pages/RequirementsPage.test.tsx \
  src/pages/WorkflowRunDetailPage.test.tsx \
  src/pages/quality/QualityPages.test.tsx
```

本轮没有修改业务代码。未运行新的 AI 生成、设计回传、代码执行或验收流程；因此不能判断新生成产物质量、多人交接可靠性和完整链路耗时。后续完整验证需要一条明确用于体验的需求及其 PRD、设计、测试设计和实际执行证据。
