# Workflow Review Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace workflow feedback and manual-edit dialogs with a persistent right-side review workspace for all editable workflow stages.

**Architecture:** Keep `WorkflowRunDetailPage` as the orchestration page, but move the selected stage actions into a shared sidebar component that supports feedback mode and manual-edit mode inline. The left column remains responsible for rendering stage artifacts, execution diffs, and review findings; the right column becomes the single place for stage-level actions and draft state.

**Tech Stack:** React, TypeScript, Vite, Vitest

---

### Task 1: Add failing workflow page tests for the review workspace

**Files:**
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`

- [ ] **Step 1: Write a failing test for waiting-confirmation stages**

```tsx
it('renders a persistent workflow review sidebar instead of the feedback dialog for task split', async () => {
  // load TASK_SPLIT_WAITING_CONFIRMATION workflow
  // assert sidebar text exists
  // assert old modal copy is absent
});
```

- [ ] **Step 2: Run the workflow page test to verify it fails**

Run: `pnpm --filter flowx-web test -- WorkflowRunDetailPage.test.tsx`
Expected: FAIL because feedback and manual edit still rely on dialogs.

- [ ] **Step 3: Write a failing test for action-specific loading or draft clearing**

```tsx
it('keeps workflow drafts in the sidebar and clears them after successful feedback submit', async () => {
  // type feedback
  // submit revise action
  // assert textarea is cleared
});
```

- [ ] **Step 4: Run the workflow page test again to verify the new case fails**

Run: `pnpm --filter flowx-web test -- WorkflowRunDetailPage.test.tsx`
Expected: FAIL because no persistent sidebar draft flow exists yet.

### Task 2: Build the shared workflow review sidebar

**Files:**
- Create: `apps/web/src/components/WorkflowReviewSidebar.tsx`
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`

- [ ] **Step 1: Add a sidebar component for workflow stage actions**

```tsx
export function WorkflowReviewSidebar(props: {
  stageTitle: string;
  stageStatus?: string;
  feedbackText: string;
  editOutputText: string;
  mode: 'feedback' | 'edit';
  activeAction: string | null;
  ...
}) {
  // renders textarea-first action flow plus inline edit mode
}
```

- [ ] **Step 2: Remove workflow feedback dialog state and wire feedback into the sidebar**

```tsx
const [workflowWorkspaceMode, setWorkflowWorkspaceMode] = useState<'feedback' | 'edit'>('feedback');
```

- [ ] **Step 3: Remove workflow edit dialog state and wire manual edit into the sidebar**

```tsx
setWorkflowWorkspaceMode('edit');
setEditOutputText(JSON.stringify(output, null, 2));
```

- [ ] **Step 4: Pass stage-specific action metadata into the sidebar**

```tsx
const workflowReviewConfig = buildWorkflowReviewConfig(selectedStage, workflowRun, ...);
```

- [ ] **Step 5: Keep execution and AI review specialized left-column content intact while moving stage-level actions into the sidebar**

```tsx
actions={[]}
```

### Task 3: Verify the workflow review workspace

**Files:**
- Test: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`
- Test: `apps/web/package.json`

- [ ] **Step 1: Run the updated workflow page tests**

Run: `pnpm --filter flowx-web test -- WorkflowRunDetailPage.test.tsx`
Expected: PASS

- [ ] **Step 2: Run the full web test suite**

Run: `pnpm --filter flowx-web test`
Expected: PASS

- [ ] **Step 3: Run repo checks**

Run: `pnpm check`
Expected: If it fails, capture whether it is blocked by unrelated existing API test failures.
