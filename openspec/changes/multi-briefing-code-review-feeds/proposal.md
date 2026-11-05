## Why

一个项目现在只有一份简报配置和一份代码审查配置，生成范围固定为所属工作区的全部仓库。工作区里常有多组仓库，需要各自成简报、各自做审查，并送到不同的人和不同的时刻。继续堆在同一份配置上，调度水位、历史记录和投递都拆不开。

## What Changes

- 项目下的简报从单例配置改为多份。每一份有名称、勾选的工作区仓库、发送时刻，以及从本项目投递目标中挑选的接收方。
- 项目下的代码审查同样改为多份，结构与简报平行，数据模型和调度互不合并。
- 生成结果按「份 + 周期 + 日期」唯一。仓库勾选变化时更新当天同一条记录，并保留当时的范围快照。
- 同一仓库可以同时属于多份。工作区新增仓库不自动进入已有份，配置中提示尚未加入的仓库。
- Webhook 接入（`BriefingSource`）和代码审查沙箱仍按仓库维护，多份共用，不按份复制数据源。
- **BREAKING** 移除项目级单例 `ProjectBriefingConfig`、`ProjectCodeReviewConfig` 及其一对一 API。已有配置迁移为一份「默认」：简报勾选当时工作区全部仓库，代码审查勾选当时未被排除的仓库，历史记录挂到该默认份。
- **BREAKING** 移除工作区级 `CodeReviewSource` 排除列表及其设置页。仓库范围改由每一份代码审查自己勾选。

## Capabilities

### New Capabilities

- `project-briefing-feeds`: 项目内多份简报的仓库范围、调度、投递、生成与历史身份。
- `project-code-review-feeds`: 项目内多份代码审查的仓库范围、调度、投递、生成与历史身份，以及工作区排除列表的退役。

### Modified Capabilities

- 无。

## Impact

- 后端：`apps/api/src/briefings`、`apps/api/src/daily-code-review` 的配置、调度、生成和投递；Prisma 模型与 migration。
- 前端：项目设置中的配置面板，简报页和代码审查页的生成与历史，`apps/web/src/api.ts` 与类型；移除代码审查数据源排除页。
- 保留：`BriefingSource` 设置页、按仓库的代码审查 sandbox、项目级 `DeliveryTarget` 的归属。
- 本地 MCP、CLI、Skill 与 `@flowx-ai/protocol` 不调用简报和代码审查，本次不新增本地工具。
- 文档：用户手册中项目设置、简报和代码审查的范围说明。
