# 设计阶段：单 Markdown + HTML 预览展示

日期：2026-07-30  
状态：已确认  
范围：Workflow 设计阶段（OpenDesign 本地回传 + Web 工作流详情展示）

## 背景

设计阶段在平台上当前会展示整棵结构化 `design` / `demo` 字段树，再叠加多端多页 HTML 预览，信息层级过长，阅读成本高。产品构思阶段已收敛为**一份 Markdown**（`prd.md`），体验更清晰。

需要在保留多端 HTML 预览能力的前提下，让设计阶段详情页与产品构思同构：人只面对两个主模块。

## 目标

1. 工作流详情 DESIGN 阶段只保留两个主模块：**设计文档（Markdown）** 与 **HTML 预览**。
2. 本地提交增加顶层 `markdown` 字段，作为 MD 模块的唯一数据源（与 brainstorm 对齐）。
3. `design` / `demo` / `surfaces` 仍可回传并持久化，供校验与预览，但 **Web 不再渲染字段树**。
4. 旧 run 无 `markdown` 时显示空态，不拼装、不迁移。

## 非目标

- 不废弃 `design` / `demo` / `surfaces`，不引入 `flowx-design-result-v3`。
- 不改 HTML 多端多页预览交互本身（Tab / 页列表 / iframe）。
- 不把旧 run 的结构化数据迁移或拼装成 markdown。
- 不改工作流状态机与确认 / 驳回状态流转。
- 不重做产品构思阶段。
- 不为「确认设计」新增「必须有 markdown」硬门槛（避免卡死历史 run）。

## 决策摘要

| 项 | 选择 |
|----|------|
| 改动范围 | 展示为主 + 协议增量 `markdown`（非整链推翻） |
| 详情页结构 | 两个主模块：MD + HTML 预览 |
| Markdown 来源 | 提交顶层 `markdown`（必填，新提交） |
| 旧数据 | 无 markdown → 空态「尚未提交设计文档」 |
| 结构化字段 | 继续存；Web 不展示树 |
| 确认门槛 | 不新增 markdown 必填校验 |
| 本地文件名 | 推荐 `design.md` |

## 架构

```
本地 design.md + design/<surfaceId>/*.html
  → flowx_submit_design({ markdown, output: { design, demo, surfaces } })
  → 云端校验 markdown + 现有 design/demo/surfaces
  → StageExecution.output 持久化 markdown + 结构化 + surfaces 清单
  → Web：设计文档（markdown） + DesignArtifactPreview
  → 人工确认（状态机不变）
```

职责：

- **Protocol**：`DesignCompletionReport` 增加顶层 `markdown: string`；`output` 仍为 v2（`design` / `demo` / `surfaces`）。
- **API**：完成本地设计时校验非空 `markdown`；`toPersistedDesignStageOutput`（或等价路径）写入顶层 markdown；旧 output 可读。
- **Web**：DESIGN 不把整棵 `design`/`demo` 塞进 `StageCard.output`；独立 MD 模块 + 现有预览模块。
- **Local / MCP / Skill / 文档**：提交带 `markdown`；指南写明 `design.md` → 确认后回传。

## 持久化形状

新提交的 DESIGN stage output 示意：

```ts
{
  format: 'markdown',
  markdown: string,       // Web MD 模块唯一数据源
  summary?: string,
  design: DesignSpec,     // 仍存，Web 不展示树
  demo: DemoArtifact,
  surfaces: DesignSurfaceInventory[]
}
```

约定：

- Web 只读 `output.markdown`（或与 brainstorm 一致的 `format === 'markdown'` + `markdown`）。
- 缺失 / 非字符串 / 空串 → MD 空态；**禁止**用 `design`/`demo`/`summary` 拼装正文。
- HTML 预览继续走现有 surfaces 清单与 design-artifacts API。

## 协议与提交

### Protocol

- `DesignCompletionReport` 增加必填 `markdown: string`（与 `BrainstormCompletionReport.markdown` 语义一致）。
- `FlowXDesignOutput` / `flowx-design-result-v2` 的 `design`/`demo`/`surfaces` 要求不变。
- Handoff / `outputContract`：增加 `resultFileName: 'design.md'`（或并列字段标明设计文档文件名）；format 仍为 `flowx-design-result-v2`；文档写明顶层 `markdown` 为平台展示正文。

### API 校验

| 路径 | 行为 |
|------|------|
| 本地 OpenDesign 完成（`completeLocalDesignSession` / MCP submit） | `markdown` 非空必填；同时校验现有 design/demo/surfaces |
| 缺 / 空 markdown | 400，错误信息明确 |
| 云端 AI 生成设计 | 持久化时**由服务端**根据结构化 `design`/`demo` 生成一篇 markdown 写入 output（仅新提交写入字段；不是 Web 展示期 fallback） |
| 旧 stage output | 不回填、不迁移 |

### 确认门槛

- 「确认设计」**不**新增「必须有 markdown」服务端校验。
- 新提交因协议必填 markdown，正常路径确认时 MD 与预览通常都有内容。

## Web 展示

DESIGN 选中时主内容区：

1. **设计文档**  
   - 有 markdown：渲染正文（展示方式对齐产品构思可读性；可用现有 pre-wrap 或后续统一 Markdown 渲染，本规格不强制换渲染器）。  
   - 无 markdown：空态文案「尚未提交设计文档」。

2. **设计稿预览**  
   - 继续使用 `DesignArtifactPreview`（多端多页 iframe）。  
   - 无 surfaces 时保持现有预览空态。

3. **StageCard**  
   - 保留阶段状态、attempt、操作按钮。  
   - **不再**把完整 `design`/`demo` 结构化树作为 `output` 展示。

两块互不依赖：旧数据可有预览无 md；异常情况下也可有 md 无预览。

## Local / MCP / 文档

- Skill / local-agent-guide：设计阶段先写并确认 `design.md`，再 `flowx_submit_design({ idempotencyKey, markdown, output })`。
- MCP schema：`report.markdown` 必填。
- 用户手册：设计阶段展示改为「设计文档 + HTML 预览」，不再描述平台上的长字段树。

## 错误处理

- 提交缺 markdown：API 400 → MCP/local 透出。
- Web MD 模块：只认 `markdown`；无则空态，无 fallback。
- HTML 预览失败路径不变。

## 测试范围

- Protocol：`DesignCompletionReport` 含 `markdown`；fixture / 契约测试更新。
- API：有 markdown 持久化成功；无 markdown 拒绝；旧 output 无 markdown 仍可读。
- Web：DESIGN 只渲染 MD + 预览；不出现 `design.pages` 等字段树；无 markdown 空态。
- Local/MCP：submit schema / adapter 携带 markdown；相关文档同步。

## 实施边界

优先顺序建议：

1. Protocol + API 校验与持久化  
2. Web 两模块展示  
3. Local/MCP/Skill/手册同步  

状态机、确认/驳回、多端 HTML 落盘与预览 API 保持现有行为，仅在持久化对象上增加 `markdown`。
