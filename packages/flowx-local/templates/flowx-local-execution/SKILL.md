---
name: flowx-local-execution
description: 仅当用户在 flowx-continue 中为当前执行阶段明确选择 FlowX 技能时，按任务说明实现改动并回报完成。阶段进行中不足以触发本技能。
---

# FlowX local execution

仅在 `flowx_get_workflow_position` 确认当前阶段是执行，且用户选择「用 FlowX 技能生成」之后使用。用户使用自己的开发技能时，实现完成后回到 `flowx-continue` 回报。

Read `.flowx/tasks/<workflow-run-id>.md` for task, branch, `workflowRunId`, `executionSessionId`, and `workflowRepositoryId`.

Implement the change, then:
1. `flowx_collect_git_report`
2. `flowx_report_completion` with those ids plus implementationSummary, testResult, and pushed

## 执行检查点与运行控制

从本次 handoff 获取 `executionSessionId`。开始工作、重要操作前后以及等待期间每 30 秒调用 `flowx_execution_checkpoint`。不要仅凭本地记录判断任务仍有效；检查点表示 Agent 最近一次回报，不等于平台可以终止 IDE。

- `CANCEL`：停止本任务的修改与命令。确认本任务启动的操作已停止后，调用 `flowx_ack_execution_command` 回执 `ACKED`；无法停止则回执 `FAILED` 并说明原因。不要终止整个 IDE 或其他任务进程，不再提交完成。
- `RESUME`：重新获取当前任务上下文，确认阻塞已解除后回执 `ACKED`，再继续；无法恢复则回执 `FAILED`。
- `REQUEST_SYNC`：执行 `flowx-local sync`，核对本任务的待上传数据；全部成功后回执 `ACKED`，否则回执 `FAILED`。命令不代表开发报告已进入可靠离线队列。
- 发生阻塞时，通过检查点传入 `blockedReason`；等待恢复命令或人工处理。
- 回执失败时使用相同 `commandId` 重试，不能把请求发出当作平台已经接收。
- 完成前再次检查状态，通过 `flowx_report_completion` 显式携带 `executionSessionId`；平台显示完成后再结束交接。
