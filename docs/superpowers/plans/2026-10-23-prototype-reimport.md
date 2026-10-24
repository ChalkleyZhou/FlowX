# 原型重新导入实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在本会话逐项执行。用户已确认设计，沿用现有隔离工作树。

**Goal:** 以统一操作支持换 AI、换 ZIP，并通过正式变更安全更新已进入研发的原型。

**Architecture:** 失败重试复用 PrototypeImport，替换材料但保留来源历史。成功后的 ZIP 更新存储在 RequirementChange.prototype 中，以独立归档和不可变分析快照接续现有工作流，不改写旧导入或旧产物。

**Tech Stack:** NestJS、Prisma/SQLite、React、Vitest。

## 任务 1：失败导入统一操作

- [x] 在 `prototype-archive.spec.ts` 添加替换不残留旧文件、旧包仍可下载的测试；在 `prototype-imports.service.spec.ts` 验证新包清除旧分析和答案，失败保留原 revision 对应材料。
- [x] 运行 `pnpm --filter flowx-api test src/prototype-imports`，确认新增断言失败。
- [x] `PrototypeArchive.save` 增加可选替换模式，仍保留 sources；`/files` 支持 `replace`，旧调用默认合并以兼容。新 Web 入口显式提交替换模式。
- [x] `PrototypeImportPanel` 统一一个主按钮，按是否选包调用 analyze 或 files，支持移除、大小校验和失败后刷新 revision。
- [x] 运行相关 API 与 Web 测试。

## 任务 2：正式变更携带原型

- [x] 添加新变更 ZIP 的组织隔离、幂等键/文件哈希、失败保留、重试复用及旧流程产物保留测试。
- [x] 运行新增 spec，确认缺少上传能力导致失败。
- [x] 给 `RequirementChange` 增加可空 `prototype Json?`，新增 additive migration，运行 `pnpm prisma:generate`。
- [x] 新增 `RequirementChangePrototypeService`，负责独立包保存、组织 AI 分析和固定快照；`RequirementChangesService` 负责幂等创建、后台租约和失败恢复。
- [x] Requirements controller 增加 multipart 原型变更与授权下载接口；Web API 和类型同步。
- [x] 工作流从变更快照导入需求与设计，使用所选 AI；正式需求上下文纳入新分析。
- [x] 需求变更表单增加可移除 ZIP、AI 选择、处理进度及下载入口，选包只允许重新走流程。
- [x] 运行原型、正式变更、工作流及 Web 定向测试。

## 任务 3：验证与交付

- [x] 更新 CHANGELOG、README、原型专题、系统设计、用户手册与 public 镜像。
- [x] 执行 `pnpm check`，本次完整检查通过，未修改无关测试。
- [x] 本地组件测试验证统一入口、选包/撤销、错误和变更路径；浏览器登录态因重启 API 失效，未执行已登录页面点击。
- [x] 依 requesting-code-review 技能审查，完成权限修复和最终验证后提交推送当前功能分支。
