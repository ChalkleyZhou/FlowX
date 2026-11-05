## Context

简报和代码审查已经分成两个模块，但范围仍然绑在项目单例上。

- `ProjectBriefingConfig`、`ProjectCodeReviewConfig` 都以 `projectId` 唯一。调度水位 `lastSchedulerSlot` 也在这一行上。
- 仓库属于 `Workspace`。生成时读取 `project.workspace.repositories`。
- 简报内容来自仓库上的 `BriefingSource` webhook 事件。代码审查用独立 sandbox，路径为 `.flowx-data/code-review/workspaces/{workspaceId}/repositories/{slug}-{id8}`，不得写入 `Repository.localPath`。
- `CodeReviewSource` 以 `repositoryId` 唯一，`isActive = false` 表示整个工作区排除该仓库。
- `DeliveryTarget` 属于项目，用 `forBriefing` / `forCodeReview` 区分用途。发送时按项目查出全部已启用且用途匹配的目标。
- 历史身份依赖 `scopeKey`。`Briefing` 的唯一键是 `(projectId, date, scopeKey)`，`DailyCodeReview` 的唯一键是 `(projectId, scopeKey)`。同一天内数据源变化会产生多行。
- 消费方只有 Web 和 API。`packages/flowx-local`、MCP、CLI、Skill 和 `@flowx-ai/protocol` 不调用这两条链路。

## Goals / Non-Goals

**Goals:**

- 一个项目可以有多份简报、多份代码审查。每一份自带名称、仓库勾选、发送时刻和投递目标。
- 生成、历史、失败重试和调度水位按份隔离。
- 已有单例配置迁成一份「默认」，当前有效仓库和现有投递行为保持不变。
- Webhook 接入和代码审查沙箱继续按仓库共用。

**Non-Goals:**

- 不把简报和代码审查合并成一张多态配置表。
- 不新增周报定时。周报仍只在对应份上手动生成。
- 不改变简报日切、整点窗口和「开启定时即发送」的现有语义。
- 不把投递目标改挂到份上，凭据仍属于项目。
- 不为本地 Agent 新增 MCP、CLI 或 Skill。

## Decisions

### 1. 平行的两套「份」，而不是共享父表

新增 `BriefingFeed` 与 `CodeReviewFeed`。字段对齐：`projectId`、`name`、`enabled`、`dailyHour`、`timezone`、`autoSend`、调度水位。仓库和投递用各自的连接表：`BriefingFeedRepository`、`BriefingFeedDeliveryTarget`，以及代码审查的对应表。

同一项目内名称唯一。

备选是一张 `Feed` 加 `kind`。两边的生成、事件来源和沙箱已经分模块，共享表会把调度和删除规则重新耦在一起。连接表分开，删除项目时跟随项目级联即可。

### 2. 正向勾选仓库

份保存选中的 `repositoryId`。仓库的 `workspaceId` 必须等于项目的 `workspaceId`。同一仓库可以出现在多份里。工作区后来新增的仓库不写入已有份。

读取配置时，接口返回该份已选仓库；页面用工作区仓库列表算出尚未加入的仓库并提示。

备选是保留 `CodeReviewSource` 作为工作区级总开关，再在份上做差集。两份需要不同仓库时，全局排除会同时作用于所有份，和「各自选择」冲突。因此移除 `CodeReviewSource` 及其 `/code-review-sources` API 和设置页。

简报没有工作区排除表。`BriefingSource` 继续只负责 webhook，不表示份的范围。选中但没有数据源的仓库参与范围快照，只是没有事件。

### 3. 历史身份改为份 + 日期

`Briefing.feedId` 必填，唯一键改为 `(feedId, date, period)`。`DailyCodeReview.feedId` 必填，唯一键改为 `(feedId, date)`。`scope` 与 `scopeKey` 仍写入，只作当时仓库和数据源的快照。重新生成或调整勾选后，更新该唯一键上的同一行。

列表接口仍按项目查询，返回 `feedId` 和份名称，可用 `feedId` 过滤。生成改为：

- `POST /briefing-feeds/:id/generate`
- `POST /code-review-feeds/:id/generate`

详情和 `POST /briefings/:id/send`、`POST /daily-code-reviews/:id/send` 保留。

移除：

- `GET` / `PUT /projects/:id/briefing-config`
- `GET` / `PUT /projects/:id/code-review-config`

配置改为：

- `GET` / `POST /projects/:id/briefing-feeds`
- `GET` / `PATCH` / `DELETE /briefing-feeds/:id`
- 代码审查使用 `/code-review-feeds` 的同样形状

没有外部旧客户端，不做单例 API 兼容层。

### 4. 投递目标仍属于项目，份只保存选用关系

创建份时，若请求未指定目标，则连上该项目当前 `isActive` 且用途匹配的全部 `DeliveryTarget`。发送时取连接表中的目标，并再次要求目标仍启用且用途标志仍匹配。连接为空则 `targetCount = 0`，不回退成「发送给项目全部目标」。

删除投递目标时删除对应连接。已有 `DeliveryLog` 行为不变。

`enabled` 与 `autoSend` 继续成对更新。定时任务只扫描 `enabled = true` 的份；到点生成后按该份的目标发送。关闭定时不阻止手动生成。

### 5. 有生成记录的份不可删除

`DELETE` 在该份已有 `Briefing` 或 `DailyCodeReview` 时返回冲突。用户用 `enabled = false` 停掉定时。仓库勾选和投递选用仍可改。

### 6. 代码审查沙箱按仓库复用

一份生成只对自己勾选的仓库调用现有 `ensureCodeReviewSandbox`。两份勾了同一仓库时各跑一次审查；第二次同步使用同一 sandbox 目录。不调用主开发 clone 的同步，不写 `Repository.localPath`。

## Risks / Trade-offs

- [同一项目同一天可能已有多行不同 `scopeKey` 的历史] → 迁移按 `(projectId, date, period)` 或代码审查的 `(projectId, date)` 只保留 `updatedAt` 最新的一行挂到默认份，其余行删除。投递日志随被删的行删除。
- [新仓库不再自动进入简报或审查] → 配置页提示未加入仓库。迁移出的默认份勾选迁移当时的有效仓库，避免升级当天漏仓库。
- [移除单例 API 和排除页] → Web 同一变更改完。无 MCP 消费者。
- [重叠仓库会重复调用审查模型] → 接受。沙箱不按份复制。
- [向下迁移无法还原后来新建的份] → 只提供向前迁移。回滚需从备份恢复数据库。

## Migration Plan

1. 新建份表和连接表。`Briefing`、`DailyCodeReview` 先增加可空 `feedId`。
2. 对每个已有 `ProjectBriefingConfig`，或已有 `Briefing` 但没有配置的项目，创建名为「默认」的 `BriefingFeed`，复制度量、时区和调度水位。
3. 默认简报份勾选该项目工作区的全部仓库，并连接当前 `forBriefing = true` 的投递目标。
4. 对代码审查做同样处理。默认份勾选工作区仓库中不存在 `CodeReviewSource.isActive = false` 的那些。
5. 把保留下来的历史行更新到对应默认份，删除同一唯一键上的较旧重复行，再把 `feedId` 设为必填并替换唯一索引。
6. 删除 `ProjectBriefingConfig`、`ProjectCodeReviewConfig`、`CodeReviewSource`。
7. 部署时 API 与 Web 一起发布。发布后定时任务扫描份，不再扫描旧配置表。

本地工具适配结论：不适用。依据是仓库内 MCP、CLI、Skill 和协议包没有简报或代码审查入口；本次不改变领取、回传、Artifact 或执行控制。

## Open Questions

无。名称唯一、正向勾选、新仓库不自动加入、投递按份选用、有历史不可删除，都按上述决定实现。
