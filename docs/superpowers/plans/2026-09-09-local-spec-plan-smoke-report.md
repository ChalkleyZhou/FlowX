# 本地 Spec & Plan、多人多端冒烟与提测报告实施计划

> **Design:** `docs/superpowers/specs/2026-09-09-local-spec-plan-smoke-report-design.md`

## Task 1：共享协议与 Artifact 内容上传

- [x] 扩展 Artifact/ExecutionSession 协议类型和契约测试。
- [x] 新增托管 Artifact 创建、内容上传、下载和校验测试。
- [x] 扩展本地 Outbox，保存待上传文件稳定副本。

## Task 2：本地 Spec & Plan

- [x] 新增 Spec & Plan handoff/completion 协议。
- [x] API 增加 claim、handoff、complete，并复用现有状态机和输出校验。
- [x] `flowx-local mcp` 增加拉取、上传和提交工具。
- [x] 增加本地 Spec & Plan Skill 模板、Web 确认衔接和文档。

## Task 3：多人多端本地冒烟

- [x] 增加 `TestRunTarget`、`TestExecution`、`TestExecutionCaseResult`、原子用例租约和迁移。
- [x] `ExecutionSession` 支持质量执行主体。
- [x] 增加聚合轮次创建、任务列表、租约认领和批量完成 API。
- [x] 实现结果冲突、revision 失效和 required/blocking 门禁。
- [x] `flowx-local mcp` 增加创建、拉取、认领和回传工具。

## Task 4：服务端提测报告

- [x] 增加确定性 HTML renderer 和 Artifact 版本化写入。
- [x] 增加最新报告查询和下载。
- [x] `completeScope` 接入本地冒烟及报告门禁。

## Task 5：Web 和文档

- [x] 增加提测详情页，展示目标端、执行分片、覆盖矩阵和报告。
- [x] 增加本地冒烟轮次创建入口。
- [x] 更新 API/types、用户手册、本地 Agent 指南、系统设计和公开镜像。

## Task 6：验证

- [x] Protocol/API/local/MCP/Web 单元测试。
- [x] Prisma generate、各包 build。
- [x] 根目录 `pnpm check`。
- [x] 文档镜像 `cmp` 和 `git diff --check`。
