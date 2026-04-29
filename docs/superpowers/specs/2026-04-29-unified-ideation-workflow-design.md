# Unified Ideation Workflow Design

## Goal

Merge FlowX ideation and development execution into one reviewable workflow.
Users should be able to run the full path from repository grounding through review, while still being able to skip product brainstorm, design, and demo stages when they want to proceed from the raw requirement.

## Current Problem

FlowX currently has two orchestration systems:

- `Requirement.ideationStatus` plus `IdeationSession` manages brainstorm, design, and demo generation.
- `WorkflowRun.status`, `currentStage`, and `StageExecution` manage repository grounding, task split, technical plan, execution, and review.

This split makes the product feel like two separate flows. It also makes progress feedback harder to unify because ideation has its own event model while workflow stages only expose `statusMessage`.

## Confirmed Stage Order

The unified workflow stage order is:

1. `REPOSITORY_GROUNDING`
2. `BRAINSTORM`
3. `DESIGN`
4. `DEMO`
5. `TASK_SPLIT`
6. `TECHNICAL_PLAN`
7. `EXECUTION`
8. `AI_REVIEW`
9. `HUMAN_REVIEW`

`REPOSITORY_GROUNDING` is always first and is not skippable. It prepares repository copies, working branches, and repository context. Design and demo stages run after grounding because they should use real repository structure, component context, and local preview commands.

## Stage Behavior

### Repository Grounding

- Required stage.
- Prepares workflow repositories.
- Generates repository context snapshots.
- Blocks later stages until it succeeds.

### Brainstorm

- Optional stage.
- Produces `output.brief`.
- If skipped, later stages continue from the raw requirement title, description, and acceptance criteria.
- Does not write to target repositories.

### Design

- Optional stage.
- Reads repository grounding context.
- Produces `output.design`.
- Does not have to write demo files by itself.
- If skipped, later stages continue without design context.

### Demo

- Optional stage.
- Reads repository grounding context and, when available, design output.
- Writes generated demo pages directly into the workflow repository copy.
- Starts or restarts local preview after writing demo files.
- If skipped, no demo files are written and local preview is not started.
- If design was skipped, users may still run demo generation. The executor should receive an explicit prompt that there is no design output and it should generate a minimal preview from the raw requirement plus repository context.

### Development Stages

`TASK_SPLIT`, `TECHNICAL_PLAN`, `EXECUTION`, `AI_REVIEW`, and `HUMAN_REVIEW` keep their current responsibilities, but they read upstream ideation outputs from `StageExecution.output` instead of treating ideation as a separate requirement-level flow.

## Data Model

`StageExecution` becomes the source of truth for all unified workflow stages.

Add a stage status:

- `SKIPPED`

Skippable stage output should use this shape:

```json
{
  "skipped": true,
  "source": "user",
  "reason": "User chose to continue with original requirement."
}
```

Primary output locations:

- `BRAINSTORM.output.brief`
- `DESIGN.output.design`
- `DEMO.output.demoPages`

Compatibility:

- Keep `IdeationSession` and `IdeationArtifact` in the first implementation pass.
- New workflow code should prefer `StageExecution.output`.
- Existing requirement ideation views may continue reading old data until the UI is migrated.
- `Requirement.ideationStatus` should no longer be the primary status source for newly created unified workflows.

## Context Rules

Task split input:

- Use `BRAINSTORM.output.brief` when present and not skipped.
- Otherwise use the raw requirement.

Technical plan input:

- Use repository grounding context.
- Include design output when present and not skipped.
- Include demo page context when present and not skipped.
- Continue without design or demo context when those stages were skipped.

Demo generation input:

- Use design output when present and not skipped.
- If design was skipped, use the raw requirement and repository context.
- Always write to the workflow repository copy, not the FlowX service repository.

## API Design

Existing workflow creation should become the main entry point. Creating a workflow should start `REPOSITORY_GROUNDING` automatically and then stop at `BRAINSTORM` after grounding succeeds.

Add workflow stage actions:

- `POST /workflow-runs/:id/brainstorm/run`
- `POST /workflow-runs/:id/brainstorm/skip`
- `POST /workflow-runs/:id/brainstorm/confirm`
- `POST /workflow-runs/:id/brainstorm/revise`
- `POST /workflow-runs/:id/design/run`
- `POST /workflow-runs/:id/design/skip`
- `POST /workflow-runs/:id/design/confirm`
- `POST /workflow-runs/:id/design/revise`
- `POST /workflow-runs/:id/demo/run`
- `POST /workflow-runs/:id/demo/skip`
- `POST /workflow-runs/:id/demo/confirm`
- `POST /workflow-runs/:id/demo/revise`

Existing task split, plan, execution, and review endpoints remain, but their preconditions should use the new stage order.

## Frontend Design

The workflow detail page becomes the main surface for the full flow.

The top stage list should display:

`仓库准备 -> 产品构思 -> 设计方案 -> Demo 页面 -> 任务拆解 -> 技术方案 -> 执行开发 -> AI 审查 -> 人工确认`

Each stage card should show:

- Status: not started, running, waiting confirmation, completed, skipped, failed.
- Current status message.
- Structured output.
- Contextual actions.

Optional stage actions:

- Brainstorm: `AI 生成产品简报`, `跳过构思`
- Design: `AI 生成设计方案`, `跳过设计`
- Demo: `生成 Demo 页面`, `直接生成 Demo`, `跳过 Demo`
- Waiting confirmation: confirm current result, revise with feedback.
- Failed: retry or skip this stage.

Requirement detail should provide a primary `启动工作流` action that navigates to the workflow detail page. The old ideation panel can remain during migration, but new workflow-driven execution should be the preferred path.

## State Transitions

The intended happy path:

1. Create workflow.
2. Run `REPOSITORY_GROUNDING`.
3. Enter `BRAINSTORM` pending state.
4. User runs or skips brainstorm.
5. Enter `DESIGN` pending state.
6. User runs or skips design.
7. Enter `DEMO` pending state.
8. User runs or skips demo.
9. Enter `TASK_SPLIT` pending state.
10. Continue through the existing development workflow.

Grounding failure marks the workflow failed and blocks all later stages.

Skipping an optional stage immediately advances to the next stage.

## Migration Strategy

Implement in small steps:

1. Extend enums, state machine, and `StageExecution` handling for the new stages and `SKIPPED`.
2. Move or wrap existing ideation executor calls so `WorkflowService` can run brainstorm, design, and demo as workflow stages.
3. Update context assembly for task split and plan to read upstream `StageExecution.output`.
4. Add skip endpoints and tests for transition behavior.
5. Update workflow detail UI to render the new optional stages.
6. Keep existing requirement ideation APIs until the unified workflow path is stable.

## Testing

Required backend coverage:

- State machine permits the new stage order.
- `REPOSITORY_GROUNDING` is not skippable.
- Skipping brainstorm advances to design and task split later uses raw requirement.
- Skipping design still allows demo run or demo skip.
- Skipping demo advances to task split without writing files or starting preview.
- Task split and technical plan include available upstream outputs and tolerate skipped ones.

Required frontend coverage:

- Workflow detail renders new ideation stages.
- Optional stages show run and skip actions.
- Skipped stages render as skipped instead of failed or completed output.
- Existing workflow stage actions still render after the optional stages.

Because this touches `apps/api/src/workflow`, `apps/api/src/common/workflow-state-machine.ts`, `apps/api/src/requirements/requirements.service.ts`, page data loading, and likely `apps/web/src/api.ts`, implementation should run:

- `pnpm --filter flowx-api test`
- `pnpm --filter flowx-web test`
- `pnpm check`

