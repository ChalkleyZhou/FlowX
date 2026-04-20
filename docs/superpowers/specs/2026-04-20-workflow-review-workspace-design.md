# Workflow Review Workspace Design

## Problem

The workflow detail page still mixes two interaction styles:

- stage outputs are read inline on the page
- stage feedback and manual edits are submitted through blocking dialogs

That breaks the reading flow. Users have to leave the current output, remember what they wanted to change, submit feedback in a modal, then return to the page. After ideation moved to a persistent review sidebar, workflow now feels like a different product.

## Goal

Make workflow review feel like the ideation review experience:

- left side stays focused on the current stage output
- right side stays available as a persistent review workspace
- feedback, confirmation, and manual edit all happen without covering the current artifact

## Scope

Apply the new review workspace to all editable workflow stages:

1. `TASK_SPLIT`
2. `TECHNICAL_PLAN`
3. `EXECUTION`
4. `AI_REVIEW`

Repository grounding, deploy, publish, and finding-level actions stay where they are unless they directly depend on the new workspace shell.

## Interaction Model

For the selected workflow stage, the page becomes a two-column workspace:

- **Left column:** the current stage artifact and its contextual content
- **Right column:** a persistent workflow review sidebar

The right sidebar replaces the feedback modal and the manual edit modal for editable stages.

### Sidebar sections

1. **Stage summary**
   - current stage name
   - current stage status
   - short helper copy explaining the next likely action

2. **Feedback draft**
   - same textarea-first pattern as ideation
   - `发送修改意见` always sits directly under the textarea
   - `确认当前阶段` or the stage decision action sits below it

3. **Manual edit mode**
   - toggled inline inside the same sidebar
   - JSON textarea replaces the feedback textarea when enabled
   - save action stays inline, not modal

4. **Stage-specific decisions**
   - task split / plan: `确认当前阶段`, `驳回`
   - execution: no confirmation action; keep `执行开发` and feedback/edit workflow inline
   - AI review: `通过`, `返工`, `回滚`, plus feedback/edit mode

## Design Rules

- The selected stage is the only stage that gets the persistent review workspace.
- The feedback modal is removed.
- The manual edit modal is removed for workflow stages.
- The send button stays visually closest to the active textarea.
- Only the clicked action shows `处理中...`.
- Successful feedback submission clears the textarea and any stage-specific draft state.
- Successful manual edit submission clears the JSON draft and exits edit mode.

## Layout

Keep the current page structure up to the selected stage area. Replace the existing selected-stage section with:

- left: stage artifact card, execution diff area, review findings area
- right: sticky workflow review sidebar

Execution and AI review keep their specialized lower sections on the left, but the actions currently duplicated in sticky/context cards move into the right sidebar so the action model stays consistent.

## Testing

Add focused page tests that verify:

- workflow selected stage renders a persistent review workspace instead of feedback dialogs
- feedback textarea and send button appear in the sidebar for waiting-confirmation stages
- manual edit mode opens inline inside the sidebar
- action-specific loading text only appears on the action being submitted
- successful feedback/manual edit clears the draft state
