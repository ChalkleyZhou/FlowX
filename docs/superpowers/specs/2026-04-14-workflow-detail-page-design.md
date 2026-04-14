# Workflow Detail Page Design

## Problem

The workflow detail page header currently mixes identity, status, description, acceptance criteria, and actions into a single top card. This creates three concrete problems:

1. The page title area is overloaded and visually noisy.
2. The requirement description is shown in the least readable position, directly under the title, even when it is long-form content.
3. Acceptance criteria appears inside the actions area, which makes an informational field compete with controls.

There is also a structural bug nearby: the metric cards block is rendered twice in sequence, which makes the top area even heavier.

## Goals

1. Make the top area answer three questions quickly: what workflow this is, what state it is in, and what actions are available.
2. Move long-form reading content into a dedicated context section without fully hiding it from the page.
3. Keep the page aligned with existing FlowX detail-page patterns and card language.
4. Remove the duplicated metric cards block.

## Non-Goals

1. Redesign the stage detail cards, diff review area, or review results flow.
2. Introduce a brand-new visual system for detail pages.
3. Refactor unrelated workflow execution logic.

## Proposed Layout

### 1. Header card becomes summary-only

Keep the existing `DetailHeader` as the top card, but reduce it to summary information:

- eyebrow: `Workflow Detail`
- title: requirement title
- badges: workspace, project, provider, workflow id, workflow status
- actions: destructive delete, back-to-list, and any other true actions only

The requirement description should no longer live in the header `description` slot, because that slot reads like a short subtitle and is not appropriate for long content. Acceptance criteria should also leave the actions area.

### 2. Add a dedicated workflow context section directly below metrics

Insert a new full-width `ContextPanel` before the workflow steps card. This panel becomes the main reading surface for requirement context.

Panel content:

- eyebrow: `Workflow Context`
- title: `需求与验收信息`
- description: short helper copy explaining that this area captures the original request and completion expectations
- body:
  - one subsection for `需求描述`
  - one subsection for `验收标准`
  - each rendered as readable paragraphs with `whitespace-pre-line`
  - fallback copy if either field is empty

This keeps the detail page’s main narrative content near the top, but no longer forces it into the title region.

### 3. Keep metrics as the operational snapshot

Retain a single metrics row after the header. This preserves the quick-glance operational view before the user scrolls into stages and artifacts.

### 4. Preserve sidebar context

Keep repository scope and workflow branches in the right sidebar. Those are contextual details tied to execution, not the page’s primary narrative content.

## Component/File Impact

### [apps/web/src/pages/WorkflowRunDetailPage.tsx](/Users/chalkley/workspace/FlowX/apps/web/src/pages/WorkflowRunDetailPage.tsx)

Primary changes:

- remove `workflowRun.requirement.description` from the top `DetailHeader`
- remove acceptance criteria text from `DetailHeader.actions`
- delete the duplicated metrics block
- insert the new `ContextPanel` for requirement description and acceptance criteria

### [apps/web/src/components/DetailHeader.tsx](/Users/chalkley/workspace/FlowX/apps/web/src/components/DetailHeader.tsx)

No API change is required if the page simply stops using the `description` slot for long content. Leave the shared component unchanged unless implementation reveals a layout issue.

## Testing Strategy

This page does not currently have route-level tests. For this change, add a focused frontend test that verifies:

1. the workflow title still renders
2. the requirement description is rendered in the new context section instead of the header subtitle position
3. the acceptance criteria is rendered in the context section
4. only one metrics region is rendered for the summary cards

If existing page test setup is too heavy for this pass, add the smallest viable render test around the page or extract a narrow presentational unit for easier verification.

## Risks and Mitigations

1. Existing local edits in the same page file may overlap with this refactor.
   - Mitigation: keep the diff narrow and work with the current file state instead of reformatting unrelated sections.
2. Long description text could still make the top of the page feel dense.
   - Mitigation: render description in the context panel body, not in card descriptions or badges.
3. Frontend tests may be sparse.
   - Mitigation: prefer a focused render test over introducing broad new test infrastructure.

## Success Criteria

1. The header reads as an operational summary, not a content dump.
2. Requirement description and acceptance criteria are easy to scan near the top of the page.
3. The duplicated metrics block is removed.
4. The page remains consistent with other FlowX detail pages.
