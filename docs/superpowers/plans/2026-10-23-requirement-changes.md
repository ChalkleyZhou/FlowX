# 需求变更实施计划

> 使用 superpowers:subagent-driven-development 按任务实施，先写失败测试，再实现并审查。沿用已有隔离工作树，不重复创建或询问实施方式。

**目标：** 一句话提交正式需求变更，或保留历史重新走一轮研发流程，无新增审批。

**架构：** 独立 RequirementChange 记录增量与作者，Requirement 维护递增修订；统一渲染有效需求上下文，工作流阶段和本地领取保存读取的修订。重新走流程关联唯一来源变更，复用现有工作流创建与仓库互斥保护，禁止复用旧构思和设计作为已完成结果。

**技术栈：** Prisma SQLite、NestJS、React、Vitest。

## 1. 后端记录与流程接续

- [x] 读取 API 规则、Prisma 组织隔离和现有工作流、云端/本地上下文入口；新增测试覆盖一句话提交、空值、作者、组织隔离、修订递增及重复提交。
- [x] 新建 `apps/api/src/requirements/requirement-changes.service.ts`、controller、DTO 和测试，schema 与 migration 增加变更记录及需求修订。
- [x] 固定 API：`GET /requirements/:id/changes` 返回 `{ revision, changes, contextRevision?, hasPendingChanges? }`，可带 `workflowRunId` 查询当前任务；`POST /requirements/:id/changes` 接受 `{ content, mode: 'SUPPLEMENT' | 'RESTART', requestId, sourceWorkflowRunId? }`；`POST /requirements/:id/changes/:changeId/restart` 重试启动，写接口均返回变更记录。
- [x] 变更记录字段包括 `id, requirementId, revision, content, mode, createdByName, createdAt, sourceWorkflowRunId, restartWorkflowRunId, restartStatus, errorMessage`；`restartStatus` 使用 `NOT_REQUESTED | PENDING | STARTING | STARTED | FAILED`。
- [x] 为重新走流程先写测试：同仓库活跃流程阻塞时保留记录，失败可重试，并发与重复启动唯一，旧流程/产物保留，导入需求不复用过时设计跳过新流程。
- [x] 实现重新启动协调与真实工作流创建接入，工作流绑定唯一变更来源，不向普通创建 DTO 暴露内部绕过开关；必要时启动恢复未完成请求。

## 2. 研发上下文与同步状态

- [x] 新增上下文增量测试，覆盖云端构思、设计、方案、开发、审查和本地构思/设计/方案/开发任务。
- [x] 单一 helper 按修订顺序渲染正式变更，原始描述不直接覆盖；后续生成/领取纳入变更，原任务记录读取修订且不会被查询伪装为已同步。
- [x] 统一查询返回 `revision`、`contextRevision`、`hasPendingChanges`，阶段输入保存 `requirementRevision`，供 Web 展示当前阶段未同步状态；旧任务按零修订兼容。

## 3. Web 最小入口

- [x] 新建 `apps/web/src/components/RequirementChangesPanel.test.tsx`，验证默认补充、一句话、空值、重新走流程、失败保留输入、历史与待启动重试。
- [x] 新建共享 `RequirementChangesPanel.tsx`；需求详情和工作流详情都接入，含“需求变更”按钮、一段输入和“提交变更 / 重新走流程”操作；长历史折叠，提交幂等 key 在失败重试时沿用。
- [x] 同步 `apps/web/src/api.ts`、`types.ts` 和页面测试；当前任务未读取新变更时展示明确提示，不增加审批或额外确认弹窗。

## 4. 审查、文档与交付

- [x] 对照设计做独立规格审查，通过后进行质量审查并修复真实问题。
- [x] 同步 README、CHANGELOG、用户手册及 public 镜像、系统设计；运行 `pnpm prisma:generate`、相关测试、全仓 `npm_config_workspace_concurrency=1 pnpm check`。
- [x] 本地使用隔离测试数据验证一句话变更、上下文携带、重新启动与历史保留；保存截图，检查两份手册镜像和 `git diff --check`。
- [x] 沿用用户 commit & push 授权，提交并推送当前功能分支。

## 验证记录（2026-10-23）

- 按用户批准的最小闭环实施，无新增审批或提交确认弹窗。规格与质量独立审查通过，审查发现的问题均补充回归后修复。
- 全仓 `npm_config_workspace_concurrency=1 pnpm check` 验证构建与 1,572 项测试：API 1,010、Web 308、本地端 163、协议 13、Cursor 扩展 78；最终补修后再次运行相同检查。中途既有 ZIP 容量及 1,500 文件用例在全量运行时触发默认 5 秒超时；独立复测通过，为这两项资源密集测试设置 30 秒时限后完整复跑，保留全部断言。
- 临时库验证迁移保留旧需求、流程与方案，并可重复 schema 同步；本地隔离数据库在同步前使用 SQLite backup 备份。
- 浏览器在工作流提交“一句话补充”，需求详情同步显示原文、作者、时间，旧任务明确提示未读取新变更。
- 在原型导入需求上提交“重新走流程”，直接进入新轮 `cmvkp8jhu000320qddfyoi9uu`，仓库准备后停在产品构思；没有复用原型跳过构思、设计。
- 旧轮 `cmvkmj5s5000920l3aevo85h7` 标记为被替代，写操作关闭，设计文档与原型页保留可浏览；原型导入入口跟随当前轮次。
- 端云正式增量、既有任务修订冻结、活跃任务阻塞、闲置排队保留、并发幂等、异步准备失败及中断恢复由集成回归覆盖。本次浏览器验证未发起实际开发或代码生成。
- 两份使用手册与 Web 镜像一致，交付前执行 `git diff --check`；沿用已授权的 commit & push，在现有功能分支提交推送并保留本地验证服务。
