# 全站服务端分页实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 按下列文件边界执行，先检查规格，再检查代码质量。

**Goal:** 所有业务记录浏览入口按需分页，数据库、网络、Web 与本地工具均不再在浏览时加载完整集合。

**Architecture:** HTTP 列表使用 `{ items, total, page, pageSize, totalPages }`，普通列表默认 20、最大 100。API 共用参数解析与响应构造，业务筛选留在模块 Service，Web 共用翻页与搜索选择器；HTTP 事件浏览统一使用页码，内部执行同步保留既有事件游标。只允许服务端内部需要完整业务范围的计算保留全量读取。

**Tech Stack:** NestJS、Prisma、TypeScript、React、Vitest、FlowX MCP。

## 文件与职责

- `packages/flowx-protocol/src/pagination.ts`：公开分页类型与常量。
- `apps/api/src/common/pagination.ts`：严格解析分页参数、构造分页响应。
- 各模块 Controller：接收查询并始终进入有界列表查询。
- 各模块 Service：复用业务权限与 where，数据库分页和聚合统计；不做内存全量切片。
- `apps/web/src/api.ts`、`types.ts`：分页请求和响应边界，所有消费方显式读取 items。
- `apps/web/src/components/ListPagination.tsx`、`PagedSelect.tsx`：页码导航与搜索选择。
- `apps/web/src/hooks/use-list-page.ts`：URL 页码、失效回退和请求竞争处理。
- `packages/flowx-local/src/mcp.ts`：薄桥接，schema 接收分页并保留结果元数据。

## 1. 共享分页契约

- [x] 在 `apps/api/src/common/pagination.spec.ts` 先测试默认 1/20、第二页 skip、100 上限、非整数/非法文本拒绝、空集合页数。
- [x] 运行 `pnpm --filter flowx-api exec vitest run src/common/pagination.spec.ts`，确认缺少实现导致失败。
- [x] 实现 `parsePagination(query)` 返回 `{ page, pageSize, skip, take }`，`pageResult(items, total, paging)` 返回统一对象；协议导出 `PageQuery`、`PageResult<T>`。
- [x] 重跑针对性测试与协议测试/构建。

## 2. 核心与管理 API

- [x] 在 `projects`、`requirements`、`workflow`、`review-artifacts` 的分页测试中先断言 `findMany` 具有 skip/take、与 count 共用条件、同时间追加 ID 排序、项目范围和筛选正确。
- [x] 迁移 `projects`、`workspaces`、`requirements`、`workflow`、`review-artifacts`、`briefings`、`daily-code-review`、`auth` Controller/Service 的全部记录列表；列表不得嵌套返回无界需求/工作流/仓库/版本。
- [x] 查询参数包括各页面实际使用的 projectId/workspaceId/versionId/planningStatus/priority/status/runType/q，统计沿用完整业务范围。
- [x] 项目、工作区、版本和仓库分别支持搜索分页、按 ID 解析已选项；不要靠初始化遍历所有页实现选择器。
- [x] 运行对应 spec，再运行 API test/build。

## 3. 质量与本地 API、MCP

- [x] 为提测、跨提测执行轮次、设计候选、用例库/模块/用例、轮次用例、报告和本地任务发现补分页契约测试。
- [x] 修改 `apps/api/src/quality` 列表入口，跨提测轮次直接查询 TestRun，不再通过所有提测展开；摘要与全范围执行计算保留正确含义。
- [x] 修改 `apps/api/src/cursor-local` 任务发现入口，混合任务按服务端统一排序分页；OpenDesign 与主任务有独立页码。
- [x] 修改 `packages/flowx-local/src/mcp.ts` 的列表 schema、实际透传和响应解析；测试真实请求参数、元数据与错误映射。
- [x] 检查 `packages/flowx-local/templates` 对数组响应的假设并同步翻页说明。
- [x] 升级提示使用可识别的契约错误，默认接口始终有界，不为旧调用保留全量兼容回退。
- [x] 运行质量相关 API spec、本地包 test/build。

## 4. Web 核心列表与请求边界

- [x] 先更新 `api.test.ts` 与核心列表交互测试，验证翻页发第二页请求、筛选重置、统计独立、删除末页回退、失败与竞争请求行为。
- [x] 将 `api.ts` 中所有业务数组列表 helper 改为分页对象，补齐查询参数和新增子列表 helper，类型统一使用 PageResult。
- [x] `RequirementsPage`、`WorkflowRunsPage`、`BugsPage`、`IssuesPage`、`ProjectsPage`、`WorkspacesPage` 使用服务端过滤和分页，去掉全量 filter/slice。
- [x] `project-scope-context.tsx`、`ScheduleHubPage`、`ScheduleAssignmentDialog` 和项目/需求详情拆出按需查询，当前选中项目不能依赖是否位于第一页。
- [x] 甘特图保留时间窗，并增加需求行分页；依赖和统计不得从当前页推断完整业务范围。
- [x] 运行针对性 Web spec 和 build。

## 5. Web 质量与管理列表

- [x] `pages/quality` 提测/执行/选例/候选/结果/报告改用对应分页入口，跨页选择以明确 ID 保留，不能将当前页当全部范围提交。
- [x] `BriefingsPage`、`CodeReviewsPage`、`BriefingSourcesPage`、`DeliveryTargetsPage`、`OrganizationUsersPage`、`PersonalApiTokensPage` 分页加载并复用通用控件。
- [x] `ProjectDetailPage` 的版本、简报与审查配置以及其他可增长子列表分别有界，选择器使用搜索与用户触发加载更多。
- [x] 迁移相关测试 fixture，不能为了旧 mock 恢复生产全量回退。
- [x] 运行对应 Web spec 和 build。

## 6. 文档、扫描和验收

- [x] 更新 README、CHANGELOG、`docs/system-design.md`、用户手册、本地指南与镜像；记录 API 读取契约变化、客户端升级与默认页大小。
- [x] 全仓扫描所有 GET 数组记录入口、`findMany`、前端 slice 和选择器，逐项确认浏览链路有界。
- [x] 先做规格审查，再做独立代码质量审查，修复后重验。
- [x] 运行 `pnpm check`、local/protocol build、`git diff --check`、两份手册 cmp；必要时 prisma:generate 仅用于已有 schema 的 client，不修改 schema。
- [x] 浏览器检查普通列表、质量列表、搜索选择器的实际请求和翻页。

## 执行与兼容记录

设计已由用户“继续”确认，直接在隔离工作区执行，不另行等待计划确认；不自动提交、推送或发布。当前无用户未提交业务改动，先前质量变更已在 b9f3e33。服务端内部方法可保留原业务返回用于内部完整范围计算，但所有浏览 HTTP 入口必须显式走分页；不能让旧 MCP 将分页第一页当成完整集合。


## 验收结果

- 规格和独立代码审查完成；发现的失效项目 404、配置搜索、末页删除回退、模块换库重置、需求测试设计过滤和最新 SPEC_PLAN 投影六项问题均修复并复核。
- 最终 `pnpm check` 退出码 0：API 160 文件 / 1242 项，Web 59 文件 / 411 项，本地包 29 文件 / 187 项，共享协议 5 文件 / 16 项，Cursor 扩展 13 文件 / 78 项全部通过；API、Web 和协议构建通过。本地包独立构建通过。
- 浏览器使用隔离临时 SQLite 验证：45 项目分页、选择器首屏 20 条及用户点击加载更多、搜索并选择页外项目、45 需求最后一页仅 5 条、25 用例库第三页仅 5 条。未修改用户运行数据库。截图位于 `/tmp/flowx-pagination-evidence/`。
- 本地适配结论：需要适配，已同步唯一 MCP 入口的 schema、参数透传、分页元数据、契约标记及四份技能模板；CLI 和 IDE 复用该入口，无新增业务规则。旧客户端收到 426 后需升级配套构建并重载 MCP，本次不发布 npm。
- 单次报告内容、固定能力、执行确认上下文以及服务端完整业务计算保留完整范围；云效单人查询例外已同步说明。
- README、CHANGELOG、系统设计、用户和本地手册及 public 镜像已同步；交付不自动提交、推送或发布。
