# Commit-Driven Project Change Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the commit-category-first briefing body with a commit-backed project change overview, grouped topics, open questions, and a complete development-record appendix.

**Architecture:** Keep commit collection and briefing persistence unchanged. Change the structured AI contract to return topic references keyed by real commit ids, validate every AI reference against collected facts before accepting the result, and render the validated topics above the existing deterministic commit categories. When AI is unavailable or invalid, render a conservative overview plus the development-record appendix without inferred topics or questions.

**Tech Stack:** NestJS, TypeScript strict mode, Vitest, JSON Schema, Markdown/HTML rendering.

---

### Task 1: Define the commit-only AI contract

**Files:**
- Modify: `apps/api/src/briefings/briefing-facts.ts`
- Modify: `apps/api/src/prompts/briefing-summary.prompt.ts`
- Modify: `apps/api/src/ai/briefing-summary.output.schema.json`
- Test: `apps/api/src/briefings/briefing-ai-summarizer.service.spec.ts`

- [ ] **Step 1: Write a failing service test for the new output shape**

Change the AI fixture to return `topics` and `openQuestions`, with each topic referencing an input commit id:

```ts
const aiOutput = {
  headline: '简报内容更适合项目成员阅读',
  summaryParagraph: '当天提交主要调整了简报内容组织。',
  topics: [{
    title: '简报内容组织调整',
    summary: '简报从提交分类调整为项目变化主题。',
    modules: ['briefing'],
    commitReferences: [{ repository: 'flowx-api', commitId: 'a1' }],
  }],
  openQuestions: [],
};
```

Assert that `summary.topics[0].commitReferences[0]` contains the canonical input title after service validation.

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter flowx-api test -- src/briefings/briefing-ai-summarizer.service.spec.ts`

Expected: FAIL because the service still expects `features`, `fixes`, `risks`, and `otherNotes`.

- [ ] **Step 3: Update facts, prompt, and JSON Schema**

Add `id` to commit facts. Replace the old structured fields with:

```ts
interface BriefingAiTopicReference {
  repository: string;
  commitId: string;
}

interface BriefingAiTopic {
  title: string;
  summary: string;
  modules: string[];
  commitReferences: BriefingAiTopicReference[];
}
```

The prompt must state that commit ids and module names come only from the facts, that low-information commits may be omitted from topics, and that testability, release, acceptance, risk, scheduling, and user-impact claims are forbidden.

- [ ] **Step 4: Run the focused test**

Run: `pnpm --filter flowx-api test -- src/briefings/briefing-ai-summarizer.service.spec.ts`

Expected: the new shape compiles; reference-validation assertions may remain failing until Task 2.

### Task 2: Validate AI references and provide conservative fallback

**Files:**
- Modify: `apps/api/src/briefings/briefing-ai-summarizer.service.ts`
- Test: `apps/api/src/briefings/briefing-ai-summarizer.service.spec.ts`

- [ ] **Step 1: Add failing tests for accepted and rejected references**

Add tests that assert:

```ts
expect(summary.topics[0].commitReferences).toEqual([{
  repository: 'flowx-api',
  commitId: 'a1',
  title: 'feat(briefing): add AI summary',
}]);
```

Also return `commitId: 'missing'` from the executor and assert the whole AI result falls back with `topics: []` and `openQuestions: []`.

- [ ] **Step 2: Run tests and verify both fail for the intended reason**

Run: `pnpm --filter flowx-api test -- src/briefings/briefing-ai-summarizer.service.spec.ts`

Expected: FAIL because references are not resolved or rejected.

- [ ] **Step 3: Implement canonical reference resolution**

Collect commits once, index them by `${repository}:${id}`, and map every AI reference to:

```ts
{
  repository: commit.projectName,
  commitId: commit.id,
  title: firstLine(commit.message),
}
```

Throw if any reference is absent, if a topic has no references, or if a module is not present in the referenced commits' repository/scope facts. The existing `catch` path then returns a fallback summary containing only a deterministic headline/paragraph and empty `topics`/`openQuestions`.

- [ ] **Step 4: Run the focused tests and verify green**

Run: `pnpm --filter flowx-api test -- src/briefings/briefing-ai-summarizer.service.spec.ts`

Expected: all summarizer tests pass.

### Task 3: Render the project change briefing structure

**Files:**
- Modify: `apps/api/src/briefings/briefing-renderer.ts`
- Test: `apps/api/src/briefings/briefing-renderer.spec.ts`

- [ ] **Step 1: Replace renderer expectations with failing project-change assertions**

Assert the Markdown contains:

```text
# FlowX · 项目变化简报 · 2026-06-03
## 今日概览
## 主要变化
### 简报内容组织调整
涉及模块：briefing
依据：feat(briefing): add daily summary [flowx]
## 待确认事项
## 研发记录
```

Assert empty `openQuestions` omits its section, and fallback output has no `主要变化` section but retains `研发记录`.

- [ ] **Step 2: Run renderer tests and verify failure**

Run: `pnpm --filter flowx-api test -- src/briefings/briefing-renderer.spec.ts`

Expected: FAIL on the old title and old `今日研发摘要` layout.

- [ ] **Step 3: Implement Markdown and HTML rendering**

Render sections in this order: overview, topics when present, open questions when present, development record. Keep commit categories in the appendix and continue escaping all HTML values. With no meaningful commits, render `今日暂无可归纳的项目变化。`; with commits but no AI topics, render a conservative commit-count overview.

- [ ] **Step 4: Run renderer tests and verify green**

Run: `pnpm --filter flowx-api test -- src/briefings/briefing-renderer.spec.ts`

Expected: all renderer tests pass.

### Task 4: Update integration fixtures and verify the API

**Files:**
- Modify: `apps/api/src/briefings/briefings.service.spec.ts`
- Verify: `apps/api/src/briefings/*.spec.ts`

- [ ] **Step 1: Update briefing service fixtures to the new summary shape**

Use `topics: []` and `openQuestions: []` in mocked summaries and retain assertions for persistence, regeneration, and delivery behavior.

- [ ] **Step 2: Run all briefing tests**

Run: `pnpm --filter flowx-api test -- src/briefings`

Expected: all API tests pass; Vitest may run the full configured suite.

- [ ] **Step 3: Run API build**

Run: `pnpm --filter flowx-api build`

Expected: TypeScript compilation and AI schema copy complete with exit code 0.

- [ ] **Step 4: Run repository check**

Run: `pnpm check`

Expected: API/web builds and all tests complete with exit code 0.

