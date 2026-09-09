---
name: flowx-spec-plan
description: 在 FlowX 工作流的 Spec & Plan 阶段，本地领取上下文、生成结构化方案和 Markdown 资料，并通过 MCP 回传等待人工确认。
---

# FlowX 本地 Spec & Plan

仅在用户要继续一个处于 `SPEC_PLAN_PENDING` 的 FlowX 工作流时使用。

1. 确认当前工作流后，用 `flowx_bind_workflow` 绑定 `spec-plan` 阶段，再调用 `flowx_get_spec_plan_handoff`。不要从聊天记录猜测 `workflowRunId`、`executionSessionId` 或 `sourceFingerprint`。
2. 根据 handoff 中的需求、构思、设计和仓库上下文生成：
   - `spec-plan.json`：严格满足 handoff 的 `outputContract`，同时包含非空 `spec.goal` 和 `plan.approach`。
   - `spec.md`：说明目标、范围、非目标、验收标准和约束。
   - `plan.md`：说明实现路径、改动点、步骤、风险和验证方式。
3. 先分别调用 `flowx_upload_artifact` 上传 `spec.md`（`SPEC_MARKDOWN`）和 `plan.md`（`PLAN_MARKDOWN`）。上传进入 Outbox 时先执行 `flowx-local sync`，确认两份资料均已成功，不要用排队中的 Artifact ID 完成阶段。
4. 调用 `flowx_submit_spec_plan`，使用 handoff 原始 `sourceFingerprint`、唯一 `idempotencyKey`、完整结构化 output 和两份已上传 Artifact ID。
5. 回传成功后停止自动推进；Spec & Plan 仍需在 FlowX Web 人工确认。

若服务端返回 source fingerprint 不一致，重新拉取 handoff 并基于新上下文生成，不要强行复用旧产物。
