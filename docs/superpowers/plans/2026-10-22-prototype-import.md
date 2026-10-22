# 原型 ZIP 导入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 用户上传原型包后直接整理需求、确认设计并接续研发。

**Architecture:** 独立导入模块保存原材料与版本，复用 AI executor、需求模型及现有工作流。导入确认是上游事实来源，工作流快照读取确认版本并进入 Spec & Plan。

**Tech Stack:** NestJS、Prisma、React、yauzl、parse5、esbuild、Vitest。

## 任务 1：原型包读取与预览

- [x] 在 `apps/api/src/prototype-imports/prototype-archive.spec.ts` 先覆盖真实 ZIP、混合识别、CSS/图片/脚本、多页链接、越界/超限/损坏归档。
- [x] 执行 `pnpm --filter flowx-api exec vitest run src/prototype-imports/prototype-archive.spec.ts`，确认缺少模块而失败。
- [x] 新增 `prototype-archive.ts`：受限流式读取，生成清单、有限文本上下文和 sandbox HTML，私有存储按版本隔离。
- [x] 运行上述测试验证资源与失败路径。

## 任务 2：AI 与导入服务

- [x] 先在 `prototype-imports.service.spec.ts` 覆盖状态、失败重试、答案、CAS 与确认锁定；在 AI contract spec 覆盖缺失字段与无效来源。
- [x] 新增 Prisma 模型和 migration、组织 scope；运行 `pnpm prisma:generate`。
- [x] 新增分析 JSON schema 与运行时校验，Codex/Cursor 共用只读结构化调用；不回退为伪造 AI 结果。
- [x] 新增模块、Controller、DTO、Service，提供上传创建、查询、修订/补传、确认、下载/预览接口；异步任务失败保留材料。
- [x] 测试覆盖确认后只读、并发旧结果不覆盖新结果、当前组织访问及服务重启恢复。

## 任务 3：工作流接续

- [x] 在 workflow 测试先覆盖未确认阻断、已确认导入快照与 grounding 后跳过重复生成。
- [x] 创建工作流时保存确认快照；grounding 后复用简报和设计，原型存入现有设计预览格式，进入 SPEC_PLAN_PENDING。
- [x] 保持现有普通/本地 Chat/OpenDesign 工作流不变，运行 API 测试。

## 任务 4：新建入口与确认面板

- [x] 先写 Web 测试验证上传无需标题、异步恢复、关键问题阻断、编辑/重试、补传与一次确认接续。
- [x] `api.ts` 增加 multipart 支持，`types.ts` 明确导入契约；新建表单增加“已有原型”入口。
- [x] 新增 `PrototypeImportPanel.tsx`，需求详情优先展示原型、草稿和澄清，后台轮询保留编辑。
- [x] 运行 Web 测试和 build，再使用真实 ZIP 浏览器验证。

## 任务 5：交付

- [x] 同步 README、用户手册和镜像、系统设计、CHANGELOG。
- [x] `npm_config_workspace_concurrency=1 pnpm check`、`git diff --check`、手册 cmp。
- [x] 独立规格审查、质量审查，修复发现后复测。
- [x] 根据已授权的 commit & push 提交推送，交付本地验证地址与限制。
