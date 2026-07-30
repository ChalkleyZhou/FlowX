---
name: flowx-product-prd
description: FlowX 产品构思：多轮头脑风暴澄清产品需求后，写出给产品经理/设计师确认的 prd.md，再经 MCP 回传。Use when FlowX local brainstorm / 产品构思 / OpenDesign brainstorm is active.
---

# FlowX 产品构思 → PRD

在 FlowX「产品构思」阶段（Cursor / OpenDesign + FlowX MCP）使用本 Skill。

## 读者与目标

- **读者：** 产品经理、设计师（以及确认需求的业务方）
- **目标：** 先**头脑风暴**把产品需求谈清楚，再产出确认后的 **`prd.md`**
- **不是：** 技术方案、接口设计、工程向规格文档（非产品 PRD）
- **产物文件名必须是 `prd.md`**，勿用 `spec.md` 或其它工程规格文件名；不要按工程规格文档套路写

## 必须流程

1. **拉上下文（MCP）**
   - `flowx_get_active_design_session`
   - `flowx_get_brainstorm_handoff`（有活跃会话时可省略 id）
2. **先头脑风暴，再写文档。** 用多轮问题澄清：要解决什么问题、给谁用、核心场景、边界、怎样算做成。未澄清够之前，不要写正式 `prd.md`。
3. **写 `prd.md`**（优先写在用户自己的项目目录），章节：
   - 背景与问题
   - 目标用户
   - 目标 / 非目标
   - 用户故事与核心场景
   - 产品规则与边界情况
   - 验收标准（用户可感知的结果）
   - 仍开放的产品问题（能关则先在对话关掉）
4. **把完整 `prd.md` 展示给用户**，明确询问是否正确、完整。
5. **仅在用户确认后**调用 `flowx_submit_brainstorm`，`report = { idempotencyKey, markdown }`，`markdown` = 完整 `prd.md` 正文。
6. **禁止**提交未确认草稿、对话原文、或把聊天记录当 PRD。

## 允许写入 `prd.md`

- 用户是谁、核心场景与产品流程（产品语言）
- 目标与非目标（业务边界）
- 产品规则、约束、边界情况（用户可感知）
- 验收标准（可观察的产品结果，不是测试代码）
- 仍开放的**产品**问题

## 禁止写入 `prd.md` 正文

- API / RPC / 协议字段、库与框架名、数据库与表结构
- 系统架构、模块拆分、组件/中间件实现方式
- 「用某某技术实现」类表述

技术疑点可在对话中标记「留给设计 / 技术方案阶段」；**不要**展开写进 `prd.md`。若用户坚持存量约束，只用一句产品语言转述（例如「需对接现有登录」），不写实现方式。

## 备注

- workflow / session id 来自 MCP，不要写死在本 Skill
- 成功回传后平台进入设计阶段，并展示本次 PRD Markdown

## 多端设计稿（设计阶段）

产品构思回传成功后进入设计阶段。先写 `design.md`，它是平台「设计文档」模块的唯一正文；与 HTML 设计稿目录并列，不要把设计说明只留在 JSON 字段中。向用户展示并确认 `design.md` 后，再回传。

若需求涉及多端，在项目或会话 `design/` 下按端建目录，**推荐**：

- `Web端/`
- `移动端/`
- `管理后台/`

每端可有多个 `.html`。其它目录名也可；FlowX Web 按实际上传的端展示 Tab（有啥展示啥）。

回传：`flowx_submit_design({ markdown, output })`，其中 `markdown` 是确认后的完整 `design.md` 正文；`output.surfaces` 仍按端多页回传（一次可只交一端；该端 pages 为完整页集）。不要使用已移除的 `designArtifact` 字段。
