# Login Page Tech-Brand Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the login page into a restrained tech-brand hero experience aligned to "AI 产研效能平台" while keeping existing auth behavior unchanged.

**Architecture:** Keep all auth logic in `LoginPage` intact, and focus changes on visual composition (hero + auth panel), copy, and responsive layout classes. Lock behavior with tests first, then implement styling/copy updates, then run focused and full web tests.

**Tech Stack:** React 19, TypeScript, Tailwind utility classes, Vitest + jsdom.

---

## File Structure and Responsibilities

- `apps/web/src/pages/LoginPage.tsx`
  - Owns login/register/DingTalk auth orchestration and page-level layout.
  - Will be updated for hero copy, visual hierarchy, and restrained tech-brand styling classes.
- `apps/web/src/pages/LoginPage.test.tsx`
  - Owns render/auth behavior verification for the page.
  - Will be updated to lock new brand copy while preserving existing auth-flow tests.

---

### Task 1: Lock the New Brand Narrative with Failing Tests First

**Files:**
- Modify: `apps/web/src/pages/LoginPage.test.tsx`
- Test: `apps/web/src/pages/LoginPage.test.tsx`

- [ ] **Step 1: Write the failing test for new hero/auth copy**

Add this test case to `LoginPage.test.tsx`:

```tsx
it('renders tech-brand hero copy for AI product R&D efficiency platform', async () => {
  const { api } = await import('../api');
  vi.mocked(api.getCurrentSession).mockRejectedValue(new Error('unauthorized'));

  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<Navigate to="/workspaces" replace />} />
            <Route path="/workspaces" element={<HomePageProbe />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
  });

  await act(async () => {
    await Promise.resolve();
  });

  const text = container.textContent ?? '';
  expect(text).toContain('AI 产研效能平台');
  expect(text).toContain('让需求、研发与审查在同一条可控流程中协同');
  expect(text).toContain('进入 AI 产研效能平台');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter flowx-web exec vitest run src/pages/LoginPage.test.tsx
```

Expected: FAIL on at least one new `toContain(...)` assertion because copy/layout has not been updated yet.

- [ ] **Step 3: Commit the failing-test checkpoint**

```bash
git add apps/web/src/pages/LoginPage.test.tsx
git commit -m "test: add failing assertions for login tech-brand copy"
```

---

### Task 2: Implement the Login Page Hero and Layout Restyle

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx`
- Test: `apps/web/src/pages/LoginPage.test.tsx`

- [ ] **Step 1: Update left hero copy to product-level narrative**

In the left hero section, replace heading/description/value-point copy with:

```tsx
<h1 className="m-0 text-[clamp(40px,5vw,58px)] font-bold leading-[1.02] tracking-[-0.03em] text-slate-50">
  AI 产研效能平台
</h1>
<h2 className="mt-3 text-[clamp(22px,2.6vw,32px)] font-semibold leading-[1.2] tracking-[-0.02em] text-slate-100">
  让需求、研发与审查在同一条可控流程中协同
</h2>
<p className="mb-0 mt-5 max-w-[700px] text-base leading-[1.75] text-slate-50/80">
  覆盖从需求构思、方案确认、执行落地到审查闭环的全链路，让每次迭代都有记录、有反馈、可继续推进。
</p>
```

Use these three value cards:

```tsx
<span className="text-xs font-bold uppercase tracking-[0.12em] text-sky-300">End-to-End Collaboration</span>
<h3 className="mt-[10px] text-lg font-bold leading-[1.35] text-slate-50">全链路产研协同</h3>
<p className="mt-[10px] leading-[1.6] text-slate-50/72">需求、方案、执行、审查、问题项在同一流程中连续流转。</p>
```

```tsx
<span className="text-xs font-bold uppercase tracking-[0.12em] text-sky-300">Structured Assets</span>
<h3 className="mt-[10px] text-lg font-bold leading-[1.35] text-slate-50">结构化过程资产</h3>
<p className="mt-[10px] leading-[1.6] text-slate-50/72">任务拆解、技术方案、执行结果与评审结论可沉淀、可复用。</p>
```

```tsx
<span className="text-xs font-bold uppercase tracking-[0.12em] text-sky-300">Iteration Loop</span>
<h3 className="mt-[10px] text-lg font-bold leading-[1.35] text-slate-50">迭代闭环提效</h3>
<p className="mt-[10px] leading-[1.6] text-slate-50/72">问题项与缺陷可回流到下一轮研发，持续优化交付质量。</p>
```

- [ ] **Step 2: Apply restrained tech-brand background and spacing system**

Update page shell classes to restrained dark-tech style:

```tsx
<div className="relative min-h-screen overflow-hidden bg-slate-950 px-6 py-8 max-[780px]:px-3 max-[780px]:py-5">
  <div className="pointer-events-none absolute inset-0">
    <div className="absolute -left-28 top-[-120px] h-[440px] w-[440px] rounded-full bg-cyan-500/12 blur-3xl" />
    <div className="absolute bottom-[-180px] right-[-140px] h-[520px] w-[520px] rounded-full bg-blue-500/12 blur-3xl" />
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(148,163,184,0.08),transparent_48%),radial-gradient(circle_at_80%_70%,rgba(56,189,248,0.07),transparent_46%)]" />
  </div>
  <div className="relative mx-auto grid w-full max-w-[1240px] items-center gap-7 [grid-template-columns:minmax(0,1.08fr)_460px] max-[1280px]:grid-cols-1">
    {/* existing left and right sections */}
  </div>
</div>
```

- [ ] **Step 3: Upgrade auth card copy and showcase styling (behavior unchanged)**

In auth card header, use:

```tsx
<span className="inline-block mb-1.5 text-sky-400 text-xs font-bold tracking-[0.08em] uppercase">认证中心</span>
<h2 className="mt-[10px] text-[30px] font-bold leading-[1.15] tracking-[-0.02em] text-slate-50">进入 AI 产研效能平台</h2>
<p className="mt-[10px] text-slate-300/90 leading-[1.7]">
  使用账号或企业身份登录，进入统一的产研协作与迭代闭环工作台。
</p>
```

And card shell:

```tsx
<Card className="w-full rounded-3xl border border-white/15 bg-slate-900/70 shadow-[0_28px_80px_rgba(15,23,42,0.52)] backdrop-blur-xl">
```

Keep existing IDs/selectors and all handlers unchanged:
- `id="login-account"`
- `id="login-password"`
- `handlePasswordSubmit`
- `loginByDingTalk`
- `confirmOrganization`

- [ ] **Step 4: Run tests to verify implementation passes**

Run:

```bash
pnpm --filter flowx-web exec vitest run src/pages/LoginPage.test.tsx
```

Expected: PASS for all login page tests, including new brand-copy assertion.

- [ ] **Step 5: Commit the implementation**

```bash
git add apps/web/src/pages/LoginPage.tsx apps/web/src/pages/LoginPage.test.tsx
git commit -m "feat: restyle login page as tech-brand platform hero"
```

---

### Task 3: Regression, Responsive Smoke Check, and Final Verification

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx` (only if responsive polish needed)
- Test: `apps/web/src/pages/LoginPage.test.tsx`

- [ ] **Step 1: Run full web test suite**

Run:

```bash
pnpm --filter flowx-web test
```

Expected: PASS with no regression in `LoginPage`, `AppLayout`, and other web tests.

- [ ] **Step 2: Manual responsive check in browser**

Run:

```bash
pnpm dev:web
```

Verify at 1440px, 1024px, and 390px:
- Desktop stays two-column with hero-first narrative.
- Mobile stacks with auth card visible first.
- Inputs/buttons remain readable and easily tappable.

- [ ] **Step 3: If any visual overlap occurs on mobile, apply minimal class fix**

Allowed micro-adjustment example:

```tsx
<section className="rounded-[30px] border border-slate-800/80 bg-slate-950/75 p-10 shadow-[0_24px_72px_rgba(15,23,42,0.55)] max-[780px]:p-5">
```

```tsx
<div className="mt-8 grid gap-[14px] [grid-template-columns:repeat(3,minmax(0,1fr))] max-[1280px]:grid-cols-1">
```

Re-run:

```bash
pnpm --filter flowx-web exec vitest run src/pages/LoginPage.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit polish (only if Step 3 changed code)**

```bash
git add apps/web/src/pages/LoginPage.tsx
git commit -m "style: tune login hero spacing for responsive layout"
```

---

## Self-Review Checklist (Completed)

### 1) Spec coverage

- Visual direction (balanced dark tech style): covered in Task 2 Step 2.
- "AI 产研效能平台" copy alignment: covered in Task 1 + Task 2 Step 1/3.
- Showcase auth panel: covered in Task 2 Step 3.
- Responsive requirements: covered in Task 3 Step 2/3.
- No auth behavior change: explicitly constrained in Task 2 Step 3.

No uncovered spec requirements found.

### 2) Placeholder scan

- No `TODO`/`TBD` placeholders.
- Every code-changing step includes concrete snippets.
- Every test/verification step includes exact command and expected result.

### 3) Type/signature consistency

- Existing handler and selector names are preserved in all steps.
- Test snippets reference current `LoginPage` render scaffolding and existing IDs.
- No new undefined functions/types introduced.

