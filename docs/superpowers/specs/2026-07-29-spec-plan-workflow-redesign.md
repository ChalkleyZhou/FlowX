# 工作流去掉 Demo、合并 Spec & Plan 设计

**Date:** 2026-07-29  
**Status:** Approved for planning  
**Scope:** 硬移除工作流 Demo 阶段；将任务拆解与技术方案合并为单一 Spec & Plan 闸门；删除 Prisma `Task`/`Plan` 及旧 API。单人执行先跑顺；多人认领与本地 Spec&Plan handoff 不在本变更。

## Goal

让主研发链路与端云设计现实对齐：

1. **给人看的 demo** 由设计阶段（OpenDesign / 设计 Artifact）承担，不再往仓库写一套 Demo 页。
2. **实现前只保留一次文档闸门**：Spec & Plan（类似 Superpowers 的写清再干），文档为主，任务列表非必须。
3. **单人优先**：同一套产物日后可加认领/分发；本变更不引入按职能拆分的多套 Spec。

## Decisions

| 主题 | 选择 |
| --- | --- |
| 范围 | 砍 Demo + 重定义拆任务→实现（不做整条 ideation 以外的大改） |
| 交付主场景 | 单人一条龙；多人在同一产物上后置增强 |
| Spec & Plan 闸门 | **一次确认**；驳回可侧重只改 Plan |
| Spec & Plan 作者（MVP） | 云端 AI 生成 + Web 确认 |
| Spec & Plan 作者（后续） | 本地 Agent handoff（本变更不做） |
| 产物形态 | 文档为主；`notes`/checklist 可选；**不强制** tasks 列表 |
| Demo | **硬移除**；存量 `DEMO_*` 一次性迁到 Spec & Plan |
| 阶段结构 | `TASK_SPLIT` + `TECHNICAL_PLAN` → **`SPEC_PLAN`**（方案 1） |
| 兼容 | **不做**：无旧 API 别名、无双写、无软废弃 |
| Prisma `Task` / `Plan` | **一并删除** |

## Stage order

```text
仓库准备 → 产品构思 → 设计方案 → Spec & Plan → 执行开发 → AI 审查 → 人工确认
```

| 阶段 | 职责 |
| --- | --- |
| 构思 | 做什么 / 不做 → PRD / brief |
| 设计 | 交互与视觉 → 设计 Artifact（评审用 demo） |
| Spec & Plan | 实现边界 + 怎么干 → 可确认文档 |
| 执行 | 按文档落地（本机 Agent / 人） |
| 审查 | 证据与验收 |

产品原则：OpenDesign 设计稿 = 给人看的 demo；仓库内再生成 Demo 页不再是工作流职责。

## State machine & enums

### StageType

- 删除：`DEMO`、`TASK_SPLIT`、`TECHNICAL_PLAN`
- 新增：`SPEC_PLAN`

### WorkflowRunStatus

删除全部 `DEMO_*`、`TASK_SPLIT_*`、`PLAN_*`。

新增：

- `SPEC_PLAN_PENDING`
- `SPEC_PLAN_WAITING_CONFIRMATION`
- `SPEC_PLAN_CONFIRMED`

### Key transitions

- 设计确认或跳过 → `SPEC_PLAN_PENDING`（不再进 Demo）
- Spec & Plan 生成成功 → `SPEC_PLAN_WAITING_CONFIRMATION`
- 确认 → `SPEC_PLAN_CONFIRMED` → `EXECUTION_PENDING`
- 驳回/修订 → `SPEC_PLAN_PENDING`（可带「侧重改 Plan」feedback）
- Spec & Plan **不可跳过**（实现前唯一闸门）
- 回滚目标列表同步去掉 Demo，加入 Spec & Plan 相关状态
- `BUG_FIX` 等跳过列表：去掉对 `DEMO` / 旧拆解·方案 stage 的引用，按新阶段集合更新

### One-shot status migration

| 旧状态 | 新状态 |
| --- | --- |
| `DEMO_PENDING` / `DEMO_WAITING_CONFIRMATION` | `SPEC_PLAN_PENDING` |
| `TASK_SPLIT_PENDING` | `SPEC_PLAN_PENDING` |
| `TASK_SPLIT_WAITING_CONFIRMATION` | `SPEC_PLAN_WAITING_CONFIRMATION` |
| `TASK_SPLIT_CONFIRMED` | `SPEC_PLAN_CONFIRMED` |
| `PLAN_PENDING` | `SPEC_PLAN_PENDING` |
| `PLAN_WAITING_CONFIRMATION` | `SPEC_PLAN_WAITING_CONFIRMATION` |
| `PLAN_CONFIRMED` | `SPEC_PLAN_CONFIRMED`（已确认方案视为 Spec&Plan 已确认；用户需再点执行，不自动跳进 `EXECUTION_PENDING`） |

历史 `StageExecution`：旧 `DEMO` / `TASK_SPLIT` / `TECHNICAL_PLAN` 行仅作只读遗留；运行时动作只识别 `SPEC_PLAN`。不提供旧 stage 的 run/confirm/skip API。

## API

只暴露：

- `POST /workflow-runs/:id/spec-plan/run`
- `POST /workflow-runs/:id/spec-plan/revise`
- `POST /workflow-runs/:id/spec-plan/confirm`
- （如有人工编辑）与现有 stage 一致的 patch/edit 模式

硬删除（无别名）：

- `/workflow-runs/:id/demo/*`
- `/workflow-runs/:id/task-split/*`
- `/workflow-runs/:id/plan/*`（及 technical-plan 等价路径）
- `/requirements/:id/demo/*`（需求侧旧 ideation Demo）

Web `api.ts`、类型、页面与测试同步删除旧调用。

## Spec & Plan artifact

写入 `StageExecution.output`（`stage = SPEC_PLAN`），建议形状：

```json
{
  "spec": {
    "goal": "...",
    "scope": [],
    "nonGoals": [],
    "acceptanceCriteria": [],
    "constraints": []
  },
  "plan": {
    "approach": "...",
    "touchpoints": [],
    "sequence": [],
    "risks": [],
    "verification": []
  },
  "notes": {
    "checklist": [],
    "openQuestions": []
  }
}
```

- 确认门槛：`spec` + `plan` 达标即可；`notes` 可空
- 不强制 `tasks[]`；模型若顺带给出轻量条目，仅可放入 `notes`，不恢复 Task 表
- 生成输入：repository grounding +（若有）brainstorm/PRD +（若有）design artifact；**不读** demoPages
- MVP：云端 executor 单一入口（如 `generateSpecPlan`），替换 `splitTasks` + `generatePlan`
- Web：一次展示、可人工编辑、确认 / 驳回修订

## Data model

硬删除 Prisma：

- `Task` model 及所有 relation
- `Plan` model 及所有 relation

执行与审查 **只** 消费：

- 需求原文
- grounding
- 可选构思 / 设计产物
- `SPEC_PLAN` 的 `StageExecution.output`
- 代码执行 / 回传证据

不再 `include: { tasks, plans }`。迁移策略：schema migration 丢表；本地/开发库可重建；生产若有数据接受丢弃或先备份后删——**不做** Task/Plan → SpecPlan 的双写兼容层。

## Demo removal

删除作为工作流阶段的能力：

- Demo stage 状态、API、UI、prompt 中「工作流 Demo 页写入仓库」主路径
- 设计确认后进入 Spec & Plan，不再启动「写 demoPages 到 working copy」编排

设计 Artifact / 设计阶段预览若仍服务设计确认，保留在 **设计阶段** 语义下，不再命名或编排为 Demo stage。

需求级旧 ideation Demo（`IdeationStatus.DEMO_*`、requirements demo 端点、相关 service/UI）一并硬删，避免双轨。

## Execution linkage

- 现有 `EXECUTION` + CodeExecution / 本地 Agent 回传保留
- 执行 prompt / handoff 上下文带上整份 Spec & Plan 文档
- 单人：一次执行会话吃完整上下文
- 多人认领：后续在同一 output 或独立 assignment 模型上扩展，**不**恢复 Task 表

## Frontend

阶段条与文案：

`仓库准备 → 产品构思 → 设计方案 → Spec & Plan → 执行开发 → AI 审查 → 人工确认`

- 去掉 Demo 卡片与操作
- 去掉任务拆解表、技术方案表（依赖 Task/Plan 的 UI）
- 新增 Spec & Plan 卡片：生成 / 展示文档 / 编辑 / 确认 / 修订

## Docs to update

同一变更内同步：

- `docs/user-manual.md` + `apps/web/public/user-manual.md`
- 涉及 Demo / 任务拆解 / 技术方案的 README、`docs/system-design.md`、相关专题（如 `docs/opendesign-design-stage.md` 若写到后续阶段）
- 交付前：`cmp` 手册镜像

历史 `docs/superpowers/plans` / 旧 specs 默认不回写；本文件为新基线。

## Non-goals

- 本地 Agent Spec & Plan handoff / MCP submit
- 按职能拆分、多人联合评审多套 Spec、工作包认领 UI
- 任何旧 status / 旧 API / Task·Plan 表兼容或别名
- 保留或软跳过 Demo 阶段

## Risks

- 高风险：`workflow-state-machine`、`workflow.service`、Prisma schema、`apps/web/src/api.ts`
- 枚举与字符串字面量散落面大（IdeationStatus、BUG_FIX 跳过列表、前端状态文案）
- 删表不可逆：需在实现计划中写清 migration / 本地 db 处理步骤

## Acceptance

1. 新工作流：设计确认或跳过后直达 Spec & Plan；无 Demo 阶段入口
2. Spec & Plan 一次生成、一次确认后可进入执行
3. 代码与 OpenAPI/前端类型中不存在 Demo stage 动作与 Task/Plan 模型 API
4. `pnpm --filter flowx-api test` 通过；受影响 `flowx-web` test 通过
5. 用户手册与镜像一致（`cmp`）
6. 无旧 `/demo`、`/task-split`、plan 端点别名

## Follow-ups（非本变更）

1. 本地 Agent：Spec & Plan handoff → 写文档 → MCP 回传 → 同一确认态  
2. 多人：在已确认 Spec & Plan 上认领/分发执行，不另起 Spec 真相源  
