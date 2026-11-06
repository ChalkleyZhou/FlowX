---
name: flowx-local-smoke
description: 仅当用户明确要执行 FlowX 本地冒烟时，按目标端领取用例、执行验证、上传证据并回传。不要从工作流状态自动进入冒烟。
---

# FlowX 本地冒烟

在用户要求执行或协作完成 FlowX 本地冒烟时使用。

1. 已有轮次时调用 `flowx_list_smoke_tasks`；只有明确要新建轮次时才调用 `flowx_create_smoke_run`。服务端会从已完成开发证据锁定默认代码 revision。
2. 选定目标端和用例后调用 `flowx_claim_smoke_task`。只执行响应中本次租约分配的用例；租约冲突或过期时重新领取，不要沿用旧 session 回传。
3. 在返回的目标 revision 上执行用例。保留实际环境、耗时和 `PASSED`、`FAILED`、`BLOCKED` 或 `SKIPPED` 结论。
4. 日志、截图、视频、JUnit 和 coverage 等资料先通过 `flowx_upload_artifact` 上传。若显示 `queued: true`，先执行 `flowx-local sync` 并确认上传成功。
5. 调用 `flowx_submit_smoke_report`，传入领取时的 `executionSessionId`、`sourceFingerprint`，以及实际验证的完整 `testedRevisions`、本次用例结果和已上传 Artifact ID。每次完成使用稳定且唯一的 `idempotencyKey`。

不要替其他开发者覆盖结果。服务端保留每次执行明细并按阻断优先级聚合；最终提测报告由 FlowX Web 在全部必测门禁满足后生成。

## 分页读取约定

所有浏览工具默认每页 20 条，`pageSize` 最大为 100。读取 `items` 与 `total/page/pageSize/totalPages`；需要更多候选时按页继续查询，不能把第一页或当前页计数当成完整范围。`flowx_list_tasks` 的 `tasks` 和 `openDesignWorkflows` 是独立分页，设计候选使用 `openDesignPage/openDesignPageSize/openDesignQ`。`flowx_list_projects` 通过 `resource=versions`（需 `projectId`）或 `resource=repositories`（需 `workspaceId`）分别发现版本与仓库，不依赖项目概要中的嵌套全量集合。

测试设计通过 `flowx_get_test_design` 的 `collection=candidates|smoke-cases|requirements|workflows` 分页；提测单 get 动作通过 `collection=snapshots|requirements|workflows|artifacts` 分页。测试任务指定 `testRunId` 时以 `collection=cases|targets|executions` 分页发现；只执行 `claim` 实际返回的完整领取范围。冒烟按页修改必须传 `partial=true` 与每条既有 `id`，不能把一页作为完整范围替换。遇到 `PAGINATION_UPGRADE_REQUIRED` 应提示升级服务端与 `@flowx-ai/local`，不能退回旧全量接口或伪装空列表。

发现项目、需求或测试记录时优先传 `q` 和已有范围过滤条件，保留分页元数据供后续选择；仅在当前页没有目标或用户继续浏览时请求下一页，不循环拉取所有页。用例多选过滤可传 `libraryIds/moduleIds/priorities`，MCP 会透传到 API；命令行 `flowx-local mcp` 与 IDE Adapter 共用此入口和分页契约请求头。
