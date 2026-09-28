# 本地技能可选、按当前流程阶段继续

> **Status:** In implementation
> **Date:** 2026-09-28
> **Scope:** `@flowx-ai/local` Skill / MCP、`apps/api` 本地任务查询、`docs/local-agent-guide.md`

## 目标

本地工作可以按各人已有技能进行。进入 FlowX 时，用户为当前这一段选择生成方式：用自己的技能按平台契约生成，或用 FlowX 技能生成。提交始终走现有 MCP 契约。

进入时机不固定。产品可以写完 PRD 和设计并在网页确认后停下；开发之后在另一台机器上打开 FlowX，从服务器指出的当前阶段继续。已完成阶段的产物只作为上下文，不在本地重做。

## 非目标

- 不把「用谁的技能」存成机器、仓库或整条工作流的偏好。下一个人、下一个阶段重新选择。
- 不在 `flowx-local` 复制工作流状态机。当前阶段由服务端判定。
- 不改变网页人工确认、状态流转和各阶段 `outputContract`。
- 不要求开发机器上已经有产品写的本地文件。前文产物从服务端读取。

## 使用方式

任何人在本地说继续做 FlowX 时，技能先联网读取当前流程，再只处理服务器允许的那一段。

```text
本地说「接着做这条 FlowX」
        │
        ▼
联网读取当前状态、可做阶段、已提交产物
        │
        ├─ 多个进行中的流程 → 用户选定一条
        ├─ 当前阶段等待网页确认 → 说明停在哪里，本地不生成下一步
        ├─ 没有可继续的流程 → 再问要不要新建
        └─ 当前阶段可以本地生成
                │
                ▼
        只问这一段：
          用我已有的技能，按规范生成
          或用 FlowX 技能生成
                │
                ├─ 契约文件已在本地 → 展示并确认后提交
                ├─ 选择已有技能 → 把 outputContract 交给用户自己的技能，完成后再提交
                └─ 选择 FlowX 技能 → 用对应 FlowX 技能生成，再提交
```

同一段对话里，阶段没变就不再追问生成方式。换阶段、换人或新开对话，重新查询服务器并重新选择。

### 交接示例

产品提交 `prd.md` 和 `design.md`，网页确认后流程停在 `SPEC_PLAN_PENDING`。开发本地进入时看到：

- 当前停在 Spec & Plan
- 已有 PRD 和设计，只读
- 这一段可选自己的技能或 FlowX 的 `flowx-spec-plan`

开发选择自己的技能后，按 `spec.md`、`plan.md` 和 `spec-plan.json` 的契约生成并提交。产品当初用了哪套技能，不约束这次选择。

若设计还停在 `DESIGN_WAITING_CONFIRMATION`，本地只提示去网页确认，不开始写方案。

## 阶段对照

服务端状态决定本地动作。本地动作只有三种：`generate`、`wait_for_confirmation`、`none`。

| 工作流状态 | 本地动作 | 当前阶段 | 契约产物 |
| --- | --- | --- | --- |
| `BRAINSTORM_PENDING` | `generate` | 构思 | `prd.md` |
| `DESIGN_PENDING` | `generate` | 设计 | `design.md` 与 HTML surfaces |
| `DESIGN_WAITING_CONFIRMATION` | `wait_for_confirmation` | 设计 | 无 |
| `SPEC_PLAN_PENDING` | `generate` | Spec & Plan | `spec.md`、`plan.md`、`spec-plan.json` |
| `SPEC_PLAN_WAITING_CONFIRMATION` | `wait_for_confirmation` | Spec & Plan | 无 |
| `SPEC_PLAN_CONFIRMED`、`EXECUTION_PENDING`、`EXECUTION_RUNNING` | `generate` | 执行 | Git 报告与完成回报 |
| `REVIEW_PENDING`、`HUMAN_REVIEW_PENDING` | `wait_for_confirmation` | 审查 | 无 |
| `DONE`、`FAILED` | `none` | 无 | 无 |

本地冒烟仍走现有领取和回传。它不从工作流状态推断；只有用户要做冒烟，或服务器返回进行中的冒烟轮次时才进入。

## 技能划分

### 入口技能

新增始终安装的 `flowx-continue`。它只负责对齐流程、询问这一段的生成方式、把契约交给选定的生成方，并在产物就绪后提交。

它不写 PRD 章节，不规定方案大纲，也不在文件已存在时重新头脑风暴。`workflowRunId`、`executionSessionId` 和 `sourceFingerprint` 只来自当次服务端响应。指纹不一致时重新拉取 handoff，不复用旧产物。上传进入 Outbox 时先执行 `flowx-local sync`。

### FlowX 生成技能

保留 `flowx-product-prd`、`flowx-spec-plan`、`flowx-local-execution`、`flowx-local-smoke`。描述改为：仅当用户为当前阶段明确选择 FlowX 技能时使用。阶段处于进行中，不足以触发这些技能。

`flowx-intake-requirement` 继续负责新建需求。启动成功后进入 `flowx-continue`，不再固定绑定构思并调用 `flowx-product-prd`。

### 自己的技能

选择已有技能时，FlowX 提供当前阶段 handoff 里的 `outputContract` 和已提交产物。用户自己的技能负责写出契约文件。文件已在本地且对应当前阶段时，入口技能展示正文，用户确认后提交。

## 服务端查询

新增一个本地可读的当前位置查询，由 API 根据工作流状态计算，MCP 只转发。返回：

- 流程 id、需求标题、状态
- `localAction` 和当前阶段
- 等待确认时的说明
- 已提交产物的引用和摘要，供下一段当上下文
- 可生成阶段的 `outputContract`

现有 `flowx_list_tasks` 仍保留，但不作为「现在该做什么」的依据。它今天把构思、设计与后续阶段拆开，而且方案阶段要本机已经有会话才可见，接手「设计刚确认」的开发者看不到统一位置。

`~/.flowx/current-workflow.json` 只保存本机最近一次绑定，不能代表其他人的进度。每次继续都重新查询服务器；绑定在用户确认这条流程和当前阶段之后写入。

## 安装与启动

`flowx-local setup` 安装入口技能和可选的 FlowX 生成技能，并继续写入 MCP。网页「本地启动」只保证项目里有 FlowX MCP。不再把阶段生成技能写入仓库的 `.cursor/skills`、`.agents/skills` 或 `.workbuddy/skills`。用户级技能在被选中时使用，避免项目里的 FlowX 写法盖过用户已有技能。

## 测试与文档

- API：上表每种状态返回对应的 `localAction`、阶段和已有产物引用。
- MCP：转发查询结果；不在本地改判状态。
- 入口技能：多流程要用户选择；等待确认时不生成；已有契约文件走确认后提交；选择 FlowX 技能才引用对应生成技能。
- 启动：项目目录不再写入阶段生成技能，已有 MCP 配置仍合并保留。
- 更新 `docs/local-agent-guide.md` 和 `apps/web/public/local-agent-guide.md`。

## 落地顺序

1. 增加当前位置查询和 MCP 转发，补状态覆盖测试。
2. 增加 `flowx-continue`，收窄现有生成技能的触发条件，并让需求登记在启动后走入口技能。
3. 本地启动停止向项目写入生成技能。
4. 同步本地 Agent 使用指南。
