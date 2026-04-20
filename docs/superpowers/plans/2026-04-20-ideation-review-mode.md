# Ideation Review Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline ideation feedback textarea with a persistent right-side review panel for brainstorming and design confirmation states.

**Architecture:** Keep `RequirementDetailPage` unchanged and refactor the two ideation panels to render a shared review sidebar only when the latest session is waiting for confirmation. The left side remains the readable artifact view; the right side owns draft feedback, optional section citation, and confirm / revise actions.

**Tech Stack:** React, TypeScript, Vite, Vitest

---

### Task 1: Cover the review layout with component tests

**Files:**
- Create: `apps/web/src/components/IdeationBrainstormPanel.test.tsx`
- Create: `apps/web/src/components/IdeationDesignPanel.test.tsx`

- [ ] **Step 1: Write the failing brainstorm panel test**

```tsx
it('shows a persistent review panel and quoted section context while waiting for confirmation', async () => {
  render(<IdeationBrainstormPanel ... />);
  click('引用到反馈');
  expect(text()).toContain('反馈面板');
  expect(text()).toContain('已引用');
});
```

- [ ] **Step 2: Run the brainstorm panel test to verify it fails**

Run: `pnpm --filter flowx-web test -- IdeationBrainstormPanel.test.tsx`
Expected: FAIL because the component does not render the review panel or citation state yet.

- [ ] **Step 3: Write the failing design panel test**

```tsx
it('keeps revise and confirm actions inside a review sidebar for design confirmation', async () => {
  render(<IdeationDesignPanel ... />);
  expect(text()).toContain('反馈面板');
  expect(text()).toContain('修改并重新生成');
});
```

- [ ] **Step 4: Run the design panel test to verify it fails**

Run: `pnpm --filter flowx-web test -- IdeationDesignPanel.test.tsx`
Expected: FAIL because the component still renders the old inline textarea-only layout.

### Task 2: Implement the shared review sidebar and section citation

**Files:**
- Create: `apps/web/src/components/IdeationReviewSidebar.tsx`
- Modify: `apps/web/src/components/IdeationBrainstormPanel.tsx`
- Modify: `apps/web/src/components/IdeationDesignPanel.tsx`

- [ ] **Step 1: Add a focused shared sidebar component**

```tsx
export function IdeationReviewSidebar(props: {
  stageLabel: string;
  feedback: string;
  onFeedbackChange: (value: string) => void;
  selectedSection: string | null;
  onClearSection: () => void;
  onConfirm: () => void;
  onRevise: () => void;
  loading: boolean;
}) {
  // sticky card with textarea, optional quoted section chip, and actions
}
```

- [ ] **Step 2: Refactor brainstorm panel into left content + right review layout**

```tsx
const waitingLayout = isWaitingConfirmation
  ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start'
  : '';
```

- [ ] **Step 3: Add reviewable section triggers to brainstorm sections**

```tsx
<SectionBlock
  label="用户故事"
  reviewLabel="头脑风暴 / 用户故事"
  onQuote={setSelectedSection}
>
```

- [ ] **Step 4: Refactor design panel to use the same review sidebar**

```tsx
<IdeationReviewSidebar
  stageLabel="设计方案"
  ...
/>
```

- [ ] **Step 5: Keep existing non-confirmation states intact**

```tsx
if (!isWaitingConfirmation) {
  return <div className="flex flex-col gap-5">...</div>;
}
```

### Task 3: Verify the web app behavior

**Files:**
- Test: `apps/web/src/components/IdeationBrainstormPanel.test.tsx`
- Test: `apps/web/src/components/IdeationDesignPanel.test.tsx`
- Test: `apps/web/package.json`

- [ ] **Step 1: Run the new component tests**

Run: `pnpm --filter flowx-web test -- IdeationBrainstormPanel.test.tsx IdeationDesignPanel.test.tsx`
Expected: PASS

- [ ] **Step 2: Run the full web test suite**

Run: `pnpm --filter flowx-web test`
Expected: PASS

- [ ] **Step 3: Run repo checks required by the workspace**

Run: `pnpm check`
Expected: PASS
