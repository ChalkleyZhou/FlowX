---
name: flowx-continue
description: 继续一条 FlowX 流程。先联网读取当前阶段，再让用户选择用自己的技能按契约生成，或用 FlowX 技能生成。多人交接时以服务器状态为准。
---

# FlowX 继续当前阶段

在用户要继续、接手或提交一条 FlowX 流程时使用。本地产物可能已经写好，流程也可能由其他人做到一半。

## 先看服务器

1. 调用 `flowx_get_workflow_position`。不要用聊天记录、本地文件或 `~/.flowx/current-workflow.json` 判断流程走到哪。
2. 返回多条时，向用户展示标题和状态，等用户选定一条。
3. 把选定流程的 `workflowRunId`、当前阶段和 `message` 告诉用户。
4. `localAction` 为 `wait_for_confirmation`：说明停在网页确认，不要生成下一步。
5. `localAction` 为 `none`：说明原因。没有可继续的流程时，再问要不要新建；新建走 `flowx-intake-requirement`。
6. `localAction` 为 `generate`：只处理返回的当前 `stage`。`priorOutputs` 和 `artifacts` 只作上下文，不重做已提交阶段。

用户确认这条流程和当前阶段后，再 `flowx_bind_workflow`。`workflowRunId`、`executionSessionId` 和 `sourceFingerprint` 只来自当次服务端响应。

## 这一段怎么生成

只问当前阶段一次：

- **用我已有的技能，按规范生成。** 把 `outputContract` 交给用户自己的技能。契约文件已经在本地时，展示正文，用户确认后提交，不要重写。
- **用 FlowX 技能生成。** 构思和设计用 `flowx-product-prd`，Spec & Plan 用 `flowx-spec-plan`，本地开发用 `flowx-local-execution`。用户明确要做冒烟时用 `flowx-local-smoke`；不要从工作流状态推断冒烟。

同一段对话里阶段没变，不要重复询问。换阶段或新开对话时重新调用 `flowx_get_workflow_position`。

## 提交

按当前阶段 handoff 提交，不要猜测标识：

- 构思：确认后的完整 `prd.md` 调用 `flowx_submit_brainstorm`。
- 设计：确认后的 `design.md` 和 HTML 调用 `flowx_submit_design`。
- Spec & Plan：先 `flowx_upload_artifact` 上传 `spec.md`（`SPEC_MARKDOWN`）和 `plan.md`（`PLAN_MARKDOWN`），再 `flowx_submit_spec_plan`。
- 执行：先用本次 `executionSessionId` 调用 `flowx_execution_checkpoint`，处理待办命令；再 `flowx_collect_git_report`，通过 `flowx_report_completion` 显式携带该会话 ID 提交。运行期间的检查点、取消和恢复规则见 `flowx-local-execution` 的“执行检查点与运行控制”，使用自己的开发技能时同样适用。

上传结果为 `queued: true` 时先执行 `flowx-local sync`，确认成功后再用 Artifact ID 完成阶段。指纹不一致时重新拉取 handoff，不复用旧产物。提交成功后停止，等待网页确认。
