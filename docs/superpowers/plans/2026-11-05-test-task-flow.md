# 测试任务闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将需求、范围冻结、执行配置、测试执行和报告串成一个可操作的测试任务闭环，同时支持人工执行人和本地 Agent 两种执行方式。

**Architecture:** 复用现有 `TestRequest`、冻结快照、`TestRun`、执行人分配和报告 API。Web 在测试任务详情中展示统一进度，在创建轮次弹窗中选择执行方式和执行人；人工轮次在执行详情页直接回传逐例结果，本地轮次继续走现有 loopback/MCP 链路。

**Tech Stack:** React 19, TypeScript, NestJS 已有质量 API, Vitest + jsdom, Tailwind。

---

## 文件变更地图

- Modify: `apps/web/src/api.ts`
  - 增加人工轮次创建和人工结果回传 helper。
- Modify: `apps/web/src/types.ts`
  - 增加人工轮次创建输入类型。
- Modify: `apps/web/src/pages/quality/QualityCreateRunDialog.tsx`
  - 增加执行方式和组织成员选择；人工方式将所选执行人写入每条用例。
- Modify: `apps/web/src/pages/quality/QualityRunDetailPage.tsx`
  - 人工轮次逐例记录结论、实际结果和备注；保存后刷新并继续生成报告。
- Modify: `apps/web/src/pages/quality/QualityRequestDetailPage.tsx`
  - 增加“范围准备 → 范围冻结 → 执行配置 → 执行与报告”的流程卡片和统一下一步入口。
- Modify: `apps/web/src/pages/quality/QualityExecution.test.tsx`
  - 覆盖人工轮次创建、执行人透传和人工结果回传。
- Modify: `apps/web/src/pages/quality/QualityPages.test.tsx`
  - 覆盖测试任务详情流程卡片和下一步操作。
- Modify: `docs/user-manual.md`, `apps/web/public/user-manual.md`
  - 更新测试任务操作说明。
- Modify: `CHANGELOG.md`
  - 记录闭环流程变化。

### Task 1: 先补人工流程失败测试

- [ ] 在 `QualityExecution.test.tsx` 的 API mock 增加 `getOrganizationMembers`、`createTestRun`、`reportTestResult`。
- [ ] 新增测试：选择“人工执行”、选择组织成员、勾选用例后点击“创建人工轮次”，断言调用 `api.createTestRun`，每条 case 带 `assignedToUserId`。
- [ ] 新增测试：人工轮次的执行详情展示“记录结果”控件，选择 `PASSED`、填写实际结果并保存，断言 `api.reportTestResult` 参数和刷新。
- [ ] 新增测试：`QualityRequestDetailPage` 展示四步流程并在范围已冻结时把主操作切换为创建执行轮次。
- [ ] 运行相关测试，确认新增测试因 UI/API helper 不存在而失败。

### Task 2: 补齐 API helper 和共享类型

- [ ] 在 `apps/web/src/types.ts` 增加 `CreateManualTestRunInput`：`name`、`runType`、可选 `sourceBugId`、`cases: { snapshotId; assignedToUserId? }[]`。
- [ ] 在 `apps/web/src/api.ts` 增加：
  - `getOrganizationMembers` 已存在，复用它。
  - `createTestRun(requestId, payload)` 调用 `POST /quality/test-requests/:id/runs`。
  - `reportTestResult(testRunCaseId, payload)` 调用 `POST /quality/test-run-cases/:id/result`。
- [ ] 保持后端 DTO、Prisma、本地协议不变，因为接口已支持这些字段。

### Task 3: 创建轮次时选择执行方式和执行人

- [ ] 扩展 `QualityCreateRunDialog` 状态：`executionMode: 'MANUAL' | 'LOCAL'`，`assigneeId`，组织成员加载状态。
- [ ] 在弹窗中增加执行方式选择：人工执行 / 本地 Agent；人工执行时加载 `api.getOrganizationMembers()`，只展示 ACTIVE 成员。
- [ ] 人工执行时要求选择执行人；创建调用 `api.createTestRun`，传入每条已选快照的 `assignedToUserId`；本地执行继续调用 `api.createLocalTestRun`。
- [ ] 将按钮和提示改为“创建执行轮次”，根据方式显示“创建人工轮次”或“创建本地轮次”。
- [ ] 保留回归轮次的来源缺陷和已有目标端映射行为。

### Task 4: 人工轮次逐例执行与回传

- [ ] 在 `QualityRunDetailPage` 为非本地且 ACTIVE 的每条用例增加结果编辑状态，支持选择 `PASSED/FAILED/BLOCKED/SKIPPED`、填写实际结果和备注。
- [ ] 保存时调用 `api.reportTestResult`；成功 toast 并静默刷新当前轮次。非当前执行人且后端拒绝时显示错误，不修改本地状态。
- [ ] 已有结果展示为只读摘要，同时提供“更新结果”入口；本地轮次继续禁止人工覆盖。
- [ ] 轮次结束后保留报告生成按钮，未完成用例时禁用最终报告并提示剩余数量。

### Task 5: 测试任务详情统一流程卡片

- [ ] 在 `QualityRequestDetailPage` 概览页增加四步进度：准备范围、冻结范围、设置执行、执行与报告。
- [ ] 根据现有状态计算当前步骤：未确认设计时指向测试设计；未完成冻结时显示“确认冻结范围”；已冻结无正式轮次时显示“创建执行轮次”；有活动轮次时显示“进入执行详情”；轮次结束后显示“查看测试报告”。
- [ ] 保留现有冒烟门禁和正式轮次按钮；卡片只做统一入口和状态解释，不绕过已有校验。
- [ ] 测试任务标题、需求、用例数量、执行轮次和报告入口在同一概览区域展示。

### Task 6: 文档、验证与提交

- [ ] 更新 `docs/user-manual.md` 与 `apps/web/public/user-manual.md`，说明测试任务四步流程、人工执行人和本地 Agent 两种方式、失败后回归轮次。
- [ ] 更新 `CHANGELOG.md`。
- [ ] 运行 `pnpm --filter flowx-web test`、`pnpm --filter flowx-web build`、`cmp -s docs/user-manual.md apps/web/public/user-manual.md`、`git diff --check`。
- [ ] 提交中文 commit，检查工作区无生成物和运行时数据。
