# 设计阶段回退重新构思设计

**Date:** 2026-07-24  
**Status:** Approved for planning  
**Scope:** 工作流处于设计阶段时，在「产品构思」面板提供「重新构思」入口，复用现有 rollback 回到 `BRAINSTORM_PENDING`，以便重新打开本地构思；设计产物保留对照。

## Goal

用户在设计阶段发现规格不对时，无需依赖页头通用「回退到上一阶段」的模糊语义，直接在「产品构思」阶段操作区一键回到构思，并继续本地重写 `spec.md` 后回传。

## Decisions

| 主题 | 选择 |
| --- | --- |
| 触发场景 | 仅 `DESIGN_PENDING` / `DESIGN_WAITING_CONFIRMATION` |
| 入口位置 | 工作流详情「产品构思」阶段 actions（与其它阶段按钮同风格） |
| 按钮文案 | 「重新构思」 |
| 后端 API | 复用 `POST /workflow-runs/:id/rollback`，不新增 reject/restart endpoint |
| 设计产物 | 保留（stage / output / OpenDesign session 不清理） |
| 本地 IDE | 不自动拉起；回到构思后由用户点「打开本地构思」 |
| Demo 及更后阶段 | 本变更不做一键回构思 |
| 构思平台待确认态 | 不引入 |

## User flow

1. 工作流状态为 `DESIGN_PENDING` 或 `DESIGN_WAITING_CONFIRMATION`
2. 用户在「产品构思」操作区点击「重新构思」
3. 二次确认：「将回到产品构思并重新编写规格；已有设计产物会保留供对照。」
4. 调用 rollback：状态 → `BRAINSTORM_PENDING`，新建 PENDING 构思 stage（`source: 'rollback'`）
5. 设计相关数据保持原样，可在设计面板对照
6. 用户使用「打开本地构思」→ 本地澄清并写 `spec.md` → 确认后 `flowx_submit_brainstorm`
7. 现有 complete 逻辑再次进入 `DESIGN_PENDING`

## Architecture

```text
[设计阶段 UI]
  产品构思面板 ·「重新构思」
        │
        ▼
POST /workflow-runs/:id/rollback
        │
        ▼
resolveRollbackTarget:
  DESIGN_* → BRAINSTORM_PENDING
        │
        ▼
createStageExecution(BRAINSTORM, PENDING)
设计 stage / session / output 不动
        │
        ▼
[构思阶段 UI]
  「打开本地构思」可用 → 本地重做 → submit → DESIGN_PENDING
```

## API and state

- **Endpoint：** 现有 `rollbackToPreviousStage`；前端 `api.rollbackWorkflowToPreviousStage`
- **状态机表：** 已支持 `DESIGN_PENDING` / `DESIGN_WAITING_CONFIRMATION` → `BRAINSTORM_PENDING`；本变更不改表
- **新建 stage：** `BRAINSTORM` / `PENDING` / `source: 'rollback'`；statusMessage 沿用或微调为「已回退到此阶段，请重新执行」
- **Cleanup：** `applyRollbackDataCleanup` 从设计回构思时不删除设计 stage、设计 output、OpenDesign session（与「保留对照」一致；现状本就不清这些，实现时显式验证）
- **旧构思 stage：** COMPLETED 历史保留可查；新 attempt 用新建 PENDING stage
- **RUNNING 拦截：** 有 RUNNING stage 时 rollback 仍返回 BadRequest（沿用）
- **成功 toast：** 「已回到产品构思，可重新打开本地构思」

## UI

修改 `apps/web/src/pages/WorkflowRunDetailPage.tsx` 中 `BRAINSTORM.actions`：

| 属性 | 值 |
| --- | --- |
| key | `restart-brainstorm` |
| label | `重新构思` |
| danger | `true`（对齐设计「驳回」） |
| enabled when | `DESIGN_PENDING` 或 `DESIGN_WAITING_CONFIRMATION`，且非 `stageActionsLocked` |
| hidden when | `BRAINSTORM_PENDING`（此时用「打开本地构思」） |
| onClick | 确认对话框 → `rollbackWorkflowToPreviousStage` → 刷新并聚焦构思阶段 |

现有页头「回退到上一阶段」保留，行为不变。

## Non-goals

- 新增 `restartBrainstorm` / `rejectBrainstorm` API
- 从 Demo、任务拆解及更后阶段一键回构思
- 构思完成后的平台待确认 / 驳回门禁
- 回退时自动打开本地 OpenDesign / Cursor
- 清理或作废设计产物
- 需求级遗留 ideation API 面板恢复挂载

## Testing

- **Web（`WorkflowRunDetailPage`）：**
  - 设计态显示「重新构思」；构思态不显示
  - 确认后调用 rollback API
- **API：** 若 DESIGN→BRAINSTORM rollback 覆盖不足，补断言：状态、新建 PENDING brainstorm stage、设计产物仍在
- 不改状态机表则不必新开大范围状态机回归

## Documentation

- `docs/user-manual.md` + `apps/web/public/user-manual.md`：设计阶段可在产品构思面板「重新构思」；设计产物保留；回到构思后可再开本地构思
- 必要时 `docs/local-agent-guide.md` + 镜像：回退后重新「打开本地构思」

## Out of scope follow-ups（可选，非本变更）

- 回退时取消活跃设计 session（若未来希望避免对照时误回传旧设计）
- Demo 及更后阶段的「回到构思」快捷入口
- 构思平台确认门禁
