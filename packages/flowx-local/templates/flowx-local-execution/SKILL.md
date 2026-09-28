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
