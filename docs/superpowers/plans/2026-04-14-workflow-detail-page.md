# Workflow Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the workflow detail page so the header becomes a concise operational summary, the requirement description and acceptance criteria move into a readable context section, and the duplicated metrics block is removed.

**Architecture:** Keep the refactor local to the workflow detail page and reuse existing shared UI components. Use one focused frontend test to lock the new information hierarchy before changing the page implementation.

**Tech Stack:** React, TypeScript, React Router, Vitest, Testing Library, Tailwind utility classes, shared FlowX UI components

---

### Task 1: Add a failing test for the new top-of-page information hierarchy

**Files:**
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`
- Test: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('renders workflow context separately from the header summary', async () => {
  render(<WorkflowRunDetailPage />);

  expect(await screen.findByRole('heading', { name: '修复登录流程' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '需求与验收信息' })).toBeInTheDocument();
  expect(screen.getByText('用户登录偶发失败，需要补齐错误提示与重试能力。')).toBeInTheDocument();
  expect(screen.getByText('登录失败时展示明确原因，并记录审计日志。')).toBeInTheDocument();
  expect(screen.getAllByText('当前状态')).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter flowx-web test -- WorkflowRunDetailPage`
Expected: FAIL because the page does not yet render the dedicated context section and still has duplicated summary metrics.

- [ ] **Step 3: Write minimal test setup**

```tsx
vi.mock('../api', () => ({
  api: {
    getWorkflowRun: vi.fn().mockResolvedValue(mockWorkflowRun),
  },
}));
```

- [ ] **Step 4: Run test to verify the failure is about behavior**

Run: `pnpm --filter flowx-web test -- WorkflowRunDetailPage`
Expected: FAIL assertions on missing `需求与验收信息` and/or duplicate metric labels, not missing imports or router setup.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/WorkflowRunDetailPage.test.tsx docs/superpowers/specs/2026-04-14-workflow-detail-page-design.md docs/superpowers/plans/2026-04-14-workflow-detail-page.md
git commit -m "test: cover workflow detail page summary layout"
```

### Task 2: Refactor the workflow detail page top area

**Files:**
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`
- Test: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`

- [ ] **Step 1: Remove long-form content from the header**

```tsx
<DetailHeader
  eyebrow="Workflow Detail"
  title={workflowRun.requirement.title}
  badges={[...]}
  actions={
    <>
      <UiButton variant="destructive" ...>
        {deleting ? '删除中...' : '删除工作流'}
      </UiButton>
      <UiButton variant="outline" asChild>
        <Link to="/workflow-runs">返回列表</Link>
      </UiButton>
    </>
  }
/>
```

- [ ] **Step 2: Add the dedicated context panel**

```tsx
<ContextPanel
  eyebrow="Workflow Context"
  title="需求与验收信息"
  description="集中查看本次工作流对应的需求背景与完成标准。"
>
  <div className="flex flex-col gap-4">
    <div className="space-y-1.5">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">需求描述</div>
      <p className="whitespace-pre-line text-sm leading-6 text-foreground">
        {workflowRun.requirement.description || '当前需求尚未填写描述。'}
      </p>
    </div>
    <div className="space-y-1.5">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">验收标准</div>
      <p className="whitespace-pre-line text-sm leading-6 text-foreground">
        {workflowRun.requirement.acceptanceCriteria || '当前需求尚未填写验收标准。'}
      </p>
    </div>
  </div>
</ContextPanel>
```

- [ ] **Step 3: Remove the duplicated metrics block**

```tsx
{workflowMetrics ? (
  <div className="grid gap-5 md:grid-cols-4">
    ...
  </div>
) : null}
```

Keep only one instance of the metrics section.

- [ ] **Step 4: Run the focused frontend test**

Run: `pnpm --filter flowx-web test -- WorkflowRunDetailPage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/WorkflowRunDetailPage.tsx apps/web/src/pages/WorkflowRunDetailPage.test.tsx
git commit -m "feat: rebalance workflow detail page header"
```

### Task 3: Run broader verification required by the repo

**Files:**
- Modify: none
- Test: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`

- [ ] **Step 1: Run the web test suite**

Run: `pnpm --filter flowx-web test`
Expected: PASS

- [ ] **Step 2: Run repository checks**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 3: Review the final diff for scope**

Run: `git diff -- apps/web/src/pages/WorkflowRunDetailPage.tsx apps/web/src/pages/WorkflowRunDetailPage.test.tsx`
Expected: only the workflow detail layout and its focused test changed for this task.

- [ ] **Step 4: Commit final verification if needed**

```bash
git add apps/web/src/pages/WorkflowRunDetailPage.tsx apps/web/src/pages/WorkflowRunDetailPage.test.tsx
git commit -m "chore: verify workflow detail page refactor"
```
