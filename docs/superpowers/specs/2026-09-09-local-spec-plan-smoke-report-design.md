# 本地 Spec & Plan、多人多端冒烟与提测报告设计

> **Status:** Approved for implementation
> **Date:** 2026-09-09
> **Scope:** FlowX API、`@flowx-ai/protocol`、`@flowx-ai/local`、兼容 MCP、Web 质量中心

## 目标

1. 在本地 Agent 中领取 Spec & Plan，回传结构化结果和本地文档，继续复用现有人工确认及后续开发流程。
2. 从提测草稿拉取不可变冒烟快照，允许多个开发者针对 Web、API、iOS、Android 等目标端并行认领和执行。
3. 本地上传日志、截图、视频、JUnit、覆盖率等原始资料；服务端校验、聚合并生成版本化 `TEST_REPORT`。
4. 保留执行人、设备、目标端、代码版本、每次 attempt 和 Artifact/Evidence 的完整追溯。

## 非目标

- 不在 `flowx-local` 复制工作流或质量状态机。
- 不从任意 Markdown 反向解析 Spec & Plan；结构化 `SpecPlanOutput` 是状态机事实来源。
- 不在第一版建设测试环境调度、设备农场、CI Worker 或传统提测审批。
- 不把大文件内容放入同步事件或完成报告 JSON。

## 核心流程

```text
SPEC_PLAN_PENDING
  -> 本地 claim + ExecutionSession
  -> 上传 spec.md / plan.md Artifact
  -> 回传 SpecPlanOutput
  -> SPEC_PLAN_WAITING_CONFIRMATION
  -> 人工确认 -> 现有执行与 Review

TestRequest(DRAFT) + TestPlan snapshots
  -> 创建 LOCAL_SMOKE TestRun
  -> 按 target 展开 TestRunCase
  -> 多人 claim TestExecution
  -> 各自上传 Artifact 并批量回传结果
  -> 服务端聚合有效 TestResult
  -> 生成 TEST_REPORT
  -> 门禁通过后 TestRequest READY
```

## 数据模型

### Spec & Plan

- 继续使用 `StageExecution(stage=SPEC_PLAN)` 保存结构化输出。
- 本地 claim 创建 `ExecutionSession(executorType=LOCAL)`，metadata 标记 `purpose=SPEC_PLAN`。
- 新增 `SPEC_MARKDOWN`、`PLAN_MARKDOWN` Artifact 类型，文档与 session/workflow 关联。

### 多人多端冒烟

- `TestRun`：一轮聚合执行，`runType=LOCAL_SMOKE`。
- `TestRunTarget`：本轮内的目标端快照，保存 key、名称、是否必测和预期代码 revision 集合。
- `TestRunCase`：用例快照与目标端形成的覆盖单元；现有 `TestResult` 保存当前有效聚合结论。
- `TestExecution`：一次开发者/设备认领，关联一个目标端和一个 `ExecutionSession`，包含租约与状态。
- `TestExecutionCaseResult`：append-only 的执行明细；服务端按覆盖单元聚合后更新 `TestResult`。

`ExecutionSession.workflowRunId` 改为可空并新增 `testRunId`，业务服务保证 session 至少绑定一个执行主体。组织权限改从 session 的 `workspaceId` 判定，兼容历史 workflow session。

### 聚合规则

- 覆盖单元键：`testRunId + snapshotId + targetId`。
- 同一代码 revision 下存在多个有效结果时，阻断优先级为 `FAILED > BLOCKED > SKIPPED > PASSED`。
- 新 attempt 不覆盖明细；只更新覆盖单元的当前有效 `TestResult`。
- 代码 revision、测试设计或快照变化后，旧执行保留但标记为 `STALE`，不参与门禁。
- 本轮所有 required 覆盖单元有结果、无 stale、无冲突且 blocking 用例通过，聚合状态才为 `PASSED`。

## Artifact 上传

采用两步上传，避免把文件塞进完成报告：

1. `POST /execution-sessions/:id/artifact-uploads` 创建 `PENDING` Artifact，返回 `artifactId` 和上传地址。
2. `PUT /artifacts/:artifactId/content` 流式写入托管存储，计算 `sha256` 和大小并转为 `AVAILABLE`。
3. `GET /artifacts/:artifactId/content` 下载或预览内容。

本地 Outbox 对待上传文件按 sha256 保存稳定副本，队列只记录路径、摘要和上传进度。对象存储接入后，第一步可返回预签名 URL，不改变 MCP 完成报告协议。

## API

### Spec & Plan

- `POST /workflow-runs/:id/spec-plan/claim-local`
- `GET /workflow-runs/:id/spec-plan/local-handoff`
- `POST /execution-sessions/:id/spec-plan/complete`

### 本地冒烟

- `POST /quality/test-requests/:id/local-smoke-runs`
- `GET /quality/test-requests/:id/local-smoke-runs`
- `GET /quality/local-smoke-runs/:id/tasks`
- `POST /quality/local-smoke-runs/:id/claim`
- `POST /execution-sessions/:id/local-smoke/complete`
- `POST /quality/local-smoke-runs/:id/finalize`

### 报告

- `GET /quality/test-requests/:id/submission-report` 返回最新报告 Artifact 元数据。
- 报告内容通过统一 Artifact content API 获取。

## 本地 MCP

- `flowx_get_spec_plan_handoff`
- `flowx_submit_spec_plan`
- `flowx_create_smoke_run`
- `flowx_list_smoke_tasks`
- `flowx_claim_smoke_task`
- `flowx_upload_artifact`
- `flowx_submit_smoke_report`

所有完成操作必须携带 `idempotencyKey`。本地 MCP 只做协议校验、文件采集和 API 调用，不判断工作流或提测状态。

## 提测报告

服务端从数据库和已上传 Artifact 生成 HTML 报告，内容包含：提测标题、项目版本、仓库 revision 集合、目标端进度、逐例结果、执行人、执行环境、失败/阻塞项和证据 Artifact ID。

每个完成的本地冒烟轮次生成独立报告版本，历史报告不覆盖。`TestRequest` 进入 `READY` 前必须存在当前 revision 集合对应的 `PASSED` 本地冒烟轮次和 `TEST_REPORT`。

## 兼容与迁移

- 现有 `INITIAL`、`SMOKE`、`REGRESSION` 轮次保持原行为。
- 现有 `TestRunCase` 的 `targetId` 可空；仅 `LOCAL_SMOKE` 强制非空。
- 现有 `TestResult` 一对一关系保留，新增明细表承载多人、多 attempt。
- 现有 workflow `ExecutionSession` 继续使用 `workflowRunId`；质量 session 使用 `testRunId`。
- `flowx-mcp` 保留兼容工具，但新能力以 `flowx-local mcp` 为主实现。

## 验证重点

- Spec & Plan 状态转换、结构化校验、重复回传和跨组织访问。
- Artifact 大小、sha256、非法状态、跨 session 引用和路径穿越。
- 多人同时认领、租约过期、重复完成、部分完成和结果冲突。
- 多仓库 revision 变化后的局部失效。
- 阻断失败不能进入 `READY`，报告版本与有效结果一致。
