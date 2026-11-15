# WorkItem 核心模型设计规格

## 目标

把版本下的需求和 Issue 统一为可分页、可分派、可启动工作流的 `WorkItem`，并让一个 WorkItem 可以有一个或多个端侧执行项。平台最终对交付结果负责：需求/问题负责业务意图，执行项负责可领取、可回传的执行单元，工作流负责从意图到提测的编排。

## 最终领域模型

```text
Project
└── ProjectVersion
    └── WorkItem (kind=REQUIREMENT | ISSUE)
        └── WorkflowRun
            └── ExecutionPlan
                └── ExecutionItem
                    └── ExecutionSession
```

`WorkItem` 是唯一业务根，不保留 `Requirement`/`Issue` 表、公共字段双写或版本工作台投影表。需求和 Issue 的字段直接收敛到同一张表，由 `kind` 约束使用范围。删除 WorkItem 时级联删除执行计划和未被其他业务引用的工作流资源。版本工作台直接分页查询 `WorkItem`，使用 `(projectId, versionId, updatedAt, id)` 索引和稳定游标。

## Prisma 数据契约

`WorkItem` 字段：

- `id`、`projectId`、`versionId`、`workspaceId`
- `kind`：`REQUIREMENT` 或 `ISSUE`
- `title`、`description`、`remark`、`status`、`priority`
- `ownerUserId`、`createdByUserId`、`createdByName`
- `createdAt`、`updatedAt`

需求字段直接使用 `acceptanceCriteria`、`functionalModule`、`riskImpact`、`productRequirementDocument`、`planningStatus`、`ideationStatus` 和 `revision`；Issue 字段直接使用 `resolution`、`severity`、复现信息、仓库、分支和报告人字段。Issue 不再通过 `requirementId` 隐式挂靠需求。

`WorkflowRun` 使用 `workItemId` 唯一绑定 WorkItem。所有权限校验、工作区/项目推导和工作流上下文从 `workflowRun.workItem` 获取。

新增执行层：

- `ExecutionPlan(workItemId, workflowRunId?, status, strategy, createdByUserId)`：一份计划描述执行拆解结果。
- `ExecutionItem(executionPlanId, title, description, target, ownerUserId?, status, sortOrder, dependsOnIds)`：可由人或本地 Agent 领取的执行单元。
- `ExecutionSession(executionItemId?)`：已有端云会话增加可选的执行项关联；简单 WorkItem 自动创建一个隐式执行项，保证本地领取协议统一。

## 状态和人机协同

WorkItem 的 `status` 表示业务项状态，Requirement 与 Issue 允许不同状态集合，但字段语义统一。会议页可以直接改状态、负责人、备注；改版本、启动工作流和拆解执行项收起到详情/更多菜单。

创建 WorkItem 后，AI 根据描述、端侧目标、仓库范围和依赖信号生成拆解建议。系统只在以下条件满足时自动拆分：存在两个以上独立执行目标、明确的跨端边界或可并行依赖。否则创建一个隐式执行项。AI 生成的计划必须经过人确认后才会派发；人也可以选择“不拆分”并直接启动单执行项工作流。

工作流入口只有 WorkItem。启动后先生成 `ExecutionPlan`，再按计划创建 ExecutionItem；合并提测由工作流编排器根据全部必需 ExecutionItem 的完成状态触发。任一执行项失败、阻塞或被取消都会阻止合并，并在 WorkItem 上聚合可见原因。

## API 与页面

- `GET /projects/:projectId/versions/:versionId/work-items`：游标分页、`kind/status/ownerId/q` 筛选、稳定排序。
- `POST /projects/:projectId/versions/:versionId/work-items`：快速创建 Requirement 或 Issue。
- `PATCH /work-items/:id`：会议页行内更新状态、负责人、备注。
- `GET /work-items/:id`：详情、工作流、执行计划和执行项。
- `POST /work-items/:id/workflow-runs`：启动工作流，可携带 `splitMode=AI|SINGLE|MANUAL`。
- `POST /work-items/:id/execution-plans/:planId/confirm`：确认 AI 拆解并派发。
- `POST /execution-items/:id/claim`、`POST /execution-items/:id/complete`：本地 Agent/端侧使用。

新增版本工作台页面复用现有表格、筛选、用户选择器和快速创建组件；默认按更新时间倒序，使用服务器端游标分页，不在客户端合并 Requirement/Issue。

## 数据迁移

迁移脚本在同一版本中完成最终表结构迁移：把现有 Requirement 和 Issue 行直接映射为 `WorkItem(kind=REQUIREMENT|ISSUE)`，将 `WorkflowRun.requirementId` 映射为 `workItemId`，更新所有关联表外键并删除旧表及旧字段。迁移失败必须整体回滚，不允许留下双写状态。

## 权限、并发和失败

所有查询先按当前用户组织、工作区、项目校验，再按 WorkItem 过滤。版本只能属于同一项目；WorkItem 改版本时校验项目一致。执行项领取使用事务和条件更新保证单领取者；完成回传必须携带幂等键和证据，重复回传返回同一结果。删除有执行记录的 WorkItem 默认拒绝，必须先取消未完成执行项并由有权限用户确认。

## 本地适配

结论：需要适配。`packages/flowx-protocol` 新增 WorkItem、ExecutionPlan、ExecutionItem 引用类型和领取/完成事件；`packages/flowx-local/src/mcp.ts` 增加版本工作项查询、执行项领取、完成回传工具，并复用 API 权限和状态机。旧的以 requirement 为根的本地工具在最终版本中改为以 `workItemId`/`executionItemId` 为根，不保留兼容参数。

## 验证范围

覆盖 Prisma 迁移、工作项分页和筛选、状态/负责人/备注更新、工作流绑定、AI 拆解确认、执行项领取与幂等完成、权限失败、删除保护、Web 版本工作台和本地 MCP 真实请求链路。同步更新 `CHANGELOG.md`、系统设计、AI 可维护性、端云协同架构、用户手册及其 Web 镜像。
