# 本地需求发起（Local Requirement Intake）设计

**日期：** 2026-08-12  
**状态：** Approved for implementation  
**范围：** 一期打通「本地 AI 创建需求 → 确认后启动工作流 → 可选进入产品构思」；产品叙事按长期 C 方向（平台以查看/确认/治理为主，Web 创建弱化为兜底）。

## 背景

FlowX 目标架构已明确：端侧工具负责专业执行，云端作为组织级控制平面（项目、需求、流程状态、人工门禁、证据与治理）。当前本地 MCP/Skill 已覆盖构思、设计、执行回传，但**需求创建仍主要依赖 Web 表单**，本地链路只能接「已有工作流」。

多数用户已具备 Cursor / Codex 等本地 AI 工具。把「发起需求」也交给本地 AI + API/Skill，平台专注查看与门禁，更符合端云协同方向。

## 目标

1. 用户可在本地 AI 会话中完成：选择项目 → 创建需求 → **确认后**启动工作流 → 可选进入现有产品构思流程。
2. 云端继续作为状态与权限事实来源；本地 MCP 为薄桥接，不复制状态机。
3. 产品叙事按长期方向 C：Web 主责查看、确认、治理；网页创建保留为兜底并弱化入口。
4. 与现有 `flowx-product-prd`、`list_tasks` / `bind` / `submit_*` 工具链无缝衔接。

## 非目标（一期）

- 不做完整 C：不删除或禁用 Web「新增需求」。
- 不引入云端原子「创建并启动」API。
- 不依赖本地仓库/目录映射推断项目（发起阶段通常尚无本地映射）。
- 不在 intake Skill 内写/回传 `prd.md` 或 `design.md`。
- 不改变工作流状态机与各阶段人工确认语义。

## 决策摘要

| 主题 | 选择 |
| --- | --- |
| 一期能力 | B：本地创建需求 + 同会话立刻启动 |
| 长期方向 | C：Web 创建降为兜底；主路径为本地 AI + Skill |
| Web 一期定位 | 能力保留；文案/入口按 C 弱化创建 |
| 项目选择 | API 列出可见工作区/项目，由用户选择 |
| 确认门禁 | 创建可轻；**启动工作流必须显式确认** |
| 启动后 | 询问是否进入构思；默认推荐进入，可选仅启动 |
| 技术方案 | 一等公民 MCP 工具 + Skill 编排；复用现有 REST 服务 |

## 架构

```text
用户 (Cursor/Codex)
  → Skill: flowx-intake-requirement
  → MCP: list_projects / create_requirement / start_workflow
  → FlowX API (现有 Requirements / Workflow / Projects 服务)
  → 平台 Web：查看需求与工作流、人工门禁

可选：start 后 bind → flowx-product-prd（现有构思链路）
```

### 原则

- **Local-first intake，cloud-authoritative state**：发起在本地完成，持久化与权限在云端。
- **创建与启动分离**：两个写工具，匹配「创建轻、启动必确认」；接受「已创建未启动」半成功，由 Skill 或 Web 补启动。
- **薄 MCP**：工具桥接现有 API，不在本地复制业务规则或状态机。

## MCP 工具

均使用现有 Personal API Token（`fxpat_…`）鉴权，与当前 OpenDesign/本地链路一致。

### `flowx_list_projects`

- **职责：** 列出当前用户可见的工作区与项目；可附带项目默认仓库摘要（若 API 已有则透出，无则一期可省略）。
- **门禁：** 只读。
- **用途：** 供用户选择 `projectId`；禁止用本地路径猜测项目。

### `flowx_create_requirement`

- **职责：** 创建需求，桥接现有 `POST /requirements`（或等价服务方法）。
- **入参（对齐现有 `CreateRequirementDto`）：**
  - 必填：`projectId`, `title`, `description`, `acceptanceCriteria`（API 当前均非空；用户未口述验收标准时，Skill 必须填一两句可观察结果占位，并在启动摘要中标明「占位，可后续在 Web 改」）
  - 可选：`repositoryIds`
- **门禁：** 轻量；不要求 `userConfirmedCreate` 类字段。字段明显不清时应先问用户，再调用。
- **出参：** 至少包含 `requirementId`、标题、`projectId`，供后续启动使用。

### `flowx_start_workflow`

- **职责：** 为已有需求启动工作流，桥接现有 `POST /workflows`（`CreateWorkflowRunDto`：`requirementId`，可选 `repositoryIds`、`aiProvider`）。
- **门禁（硬）：**
  - 调用前必须向用户展示启动摘要并获得明确确认（Skill 约束）。
  - 工具增加必填布尔 **`userConfirmedStart: true`**；非 `true` 时 MCP/适配层拒绝调用，降低误触。
- **出参：** `workflowRunId` 及启动后可用于 `bind` 的必要信息。

### 与现有工具关系

| 现有工具 | 关系 |
| --- | --- |
| `flowx_list_tasks` | 已有工作流时仍用此入口；intake 用于「尚无需求/工作流」的发起 |
| `flowx_bind_workflow` | 用户选择「启动并进入构思」后调用 |
| `flowx_get_brainstorm_handoff` / `flowx_submit_brainstorm` | 仍由 `flowx-product-prd` 负责，intake 不替代 |

## Skill：`flowx-intake-requirement`

由 `flowx-local setup` 安装到用户级 Skill 目录（与 `flowx-product-prd` 并列）。

### 触发

用户要「新建需求 / 发起需求 / 在 FlowX 开一条需求并开工」，且当前没有应优先 bind 的既有工作流时使用。若已有候选工作流，先 `flowx_list_tasks` 确认，避免重复创建。

### 固定步骤

1. **选项目：** `flowx_list_projects` → 展示列表 → 用户选择（可附推荐，必须确认）。
2. **收齐字段：** 最少 `title` + `description`；`acceptanceCriteria` 可占位；`repositoryIds` 可选。
3. **创建：** 调用 `flowx_create_requirement`；成功后回显 id/标题/项目。
4. **启动确认：** 立刻进入启动环节，但先展示摘要：
   - 需求标题与 id
   - 仓库范围（继承默认 / 指定）
   - AI 执行器（若适用）
   - 分支选项：**启动并进入构思** / **仅启动，暂不构思**
   - 仅在用户明确选择后，以 `userConfirmedStart: true` 调用 `flowx_start_workflow`
5. **分支：**
   - 进入构思：`flowx_bind_workflow` → 按 `flowx-product-prd` 继续
   - 暂不构思：提示可在 Web 查看或稍后 `list_tasks`；结束，不写 `prd.md`

### 禁止

- 未确认即启动工作流
- 将聊天记录当作正式需求正文写入平台而不经字段整理
- 在 intake Skill 内提交构思/设计产物
- 启动失败时宣称已启动
- 用本地仓库映射推断项目

### 失败与半成功

- 创建失败：不进入启动。
- 已创建、启动失败：保留需求；引导再次确认后重试启动，或回 Web 启动；不自动删除需求。

## Web 与产品叙事

- 保留「新增需求」实现与 API。
- 调整文案/入口权重：推荐「本地 AI + Skill 发起」；网页创建降为次要入口（次按钮、链接或说明区即可）。
- 本地发起与 Web 创建的需求在列表、详情、工作流上同等展示与门禁。
- 一期不强制本地、不禁用 Web 创建。

## 文档

同一变更中同步（源文件 + Web 镜像，按仓库惯例 `cmp`）：

- `docs/local-agent-guide.md` / `apps/web/public/local-agent-guide.md`
- `docs/user-manual.md` / `apps/web/public/user-manual.md`
- 必要时 `docs/edge-agent-operations.md`、根 `README.md`
- MCP/Skill 说明：新工具、intake Skill、启动确认与 `userConfirmedStart`

推荐路径文案：配置 PAT → `flowx-local setup`（含 intake Skill）→ 在 Cursor/Codex 发起新建需求 → 按 Skill 完成；Web 创建为兜底。

## 测试要点

1. MCP/适配：`list_projects`、`create_requirement`、`start_workflow` 契约与鉴权；`userConfirmedStart !== true` 时拒绝启动。
2. 创建成功后平台需求列表可见；启动成功后 `WorkflowRun` 与 Web 启动路径一致（状态/关联需求）。
3. Skill 模板含：项目必选、启动必确认、构思可选分支、半成功处理。
4. `setup` 安装 intake Skill（含 `--force` 行为与现有 setup 一致）。
5. 文档与 public 镜像一致；Web 弱化文案不破坏现有创建流程的冒烟（若有相关前端测试则更新）。

## 验收标准

1. 已配置 PAT 的本地 Agent 可列出可见项目并创建需求，平台可见。
2. 无用户确认（且无 `userConfirmedStart: true`）无法经 MCP 启动工作流。
3. 确认后可启动工作流，行为与 Web 启动一致。
4. 启动确认可选进入构思：选是可 bind 并拉 brainstorm handoff；选否不进入构思。
5. 已创建未启动时需求保留，可重试启动。
6. Web 仍可创建；手册写明本地主路径与 Web 兜底。

## 后续（导向 C，不在本期实施）

- 进一步收缩 Web 创建入口，甚至默认隐藏（权限/开关）。
- 更丰富的 Agent 友好列表（工作区树、最近项目、模板需求）。
- 若半成功成为痛点，再评估幂等「创建并启动」编排 API（仍保持启动确认语义）。
- 组织级策略：是否允许仅本地发起、审计字段（`createdVia: local_mcp`）等。

## 开放问题

无（头脑风暴中已关闭）。若实施时发现项目列表 API 对 PAT 权限不足，优先补齐只读列表契约，而不是改回本地推断项目。
