# FlowX local execution

Read `.flowx/tasks/<workflow-run-id>.md` for task, branch, `workflowRunId`, `executionSessionId`, and `workflowRepositoryId`.

Implement the change, then:
1. `flowx_collect_git_report`
2. `flowx_report_completion` with those ids plus implementationSummary, testResult, and pushed
