# Brainstorm Spec Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a user-level `flowx-brainstorm-spec` Skill via `flowx-local setup`, drive clarify → `spec.md` → confirm → MCP submit, and show the final markdown as product spec on the platform.

**Architecture:** New `setup` CLI writes Skill templates under `~/.cursor/skills` / `~/.agents/skills`. OpenDesign adapter prefers `spec.md` (legacy `brainstorm.md` fallback). MCP tool copy and Web stage labels align; workflow transition unchanged.

**Tech Stack:** `@flowx-ai/local` (Node CLI), Vitest, React Web copy, markdown docs.

**Spec:** `docs/superpowers/specs/2026-07-24-brainstorm-spec-skill-design.md`

---

## File map

| File | Responsibility |
| --- | --- |
| `packages/flowx-local/templates/flowx-brainstorm-spec/SKILL.md` | User-level brainstorm process Skill |
| `packages/flowx-local/src/setup.ts` | Parse targets, resolve paths, write-if-missing / `--force` |
| `packages/flowx-local/src/setup.test.ts` | Setup unit tests |
| `packages/flowx-local/src/index.ts` | Wire `setup` command |
| `packages/flowx-local/src/adapters/open-design-adapter.ts` | `spec.md` + instructions |
| `packages/flowx-local/src/mcp.ts` | Submit tool descriptions |
| `apps/web/.../WorkflowRunDetailPage.tsx` | Soften brainstorm copy / labels |
| `docs/local-agent-guide.md` + public mirror, opendesign/edge docs | setup + brainstorm expectation |

---

### Task 1: Skill template

**Files:**
- Create: `packages/flowx-local/templates/flowx-brainstorm-spec/SKILL.md`

- [ ] **Step 1: Write SKILL.md** covering: pull MCP context → clarify → write `spec.md` (background/goals/non-goals/requirements/acceptance) → show user → only after confirm call `flowx_submit_brainstorm` with full markdown; never submit chat logs.

- [ ] **Step 2: Commit**

```bash
git add packages/flowx-local/templates/flowx-brainstorm-spec/SKILL.md
git commit -m "feat(local): add flowx-brainstorm-spec skill template"
```

---

### Task 2: `flowx-local setup` (TDD)

**Files:**
- Create: `packages/flowx-local/src/setup.ts`
- Create: `packages/flowx-local/src/setup.test.ts`
- Modify: `packages/flowx-local/src/index.ts`

- [ ] **Step 1: Failing tests** for:
  - default targets = `cursor,codex,od`
  - `cursor` → `$HOME/.cursor/skills/flowx-brainstorm-spec/SKILL.md`
  - `codex` and `od` → `$HOME/.agents/skills/flowx-brainstorm-spec/SKILL.md` (od shares agents path when same as cursor-via-od; also write cursor path for `od` if OD uses Cursor skills — **implement od as writing both cursor + agents user roots** OR od ≡ cursor path only; pick: **`od` writes the same path as `cursor`** per spec “reuse cursor”)
  - second run without `--force` skips existing
  - `--force` overwrites

- [ ] **Step 2: Implement `setup.ts`** + CLI `flowx-local setup [targets] [--force]`

- [ ] **Step 3: Run** `pnpm --filter @flowx-ai/local test`

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(local): add flowx-local setup for user-level skills"
```

---

### Task 3: Adapter `spec.md` + instructions

**Files:**
- Modify: `packages/flowx-local/src/adapters/open-design-adapter.ts`
- Modify: related tests

- [ ] Brainstorm `resultPath` → `spec.md`; initial content points at Skill + confirm-before-submit
- [ ] `submit` reads `spec.md`, else fallback `brainstorm.md`
- [ ] Update `buildInstructions` brainstorm section
- [ ] Tests + commit: `fix(local): prefer spec.md for OpenDesign brainstorm`

---

### Task 4: MCP tool copy

**Files:**
- Modify: `packages/flowx-local/src/mcp.ts` (and `packages/flowx-mcp/src/tools.ts` if still documented)

- [ ] `flowx_submit_brainstorm` / get handoff descriptions: only after user confirmed `spec.md`
- [ ] Commit: `docs(local): clarify brainstorm MCP submit after spec confirmation`

---

### Task 5: Web + docs

**Files:**
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx` (+ test if assertions on old copy)
- Modify: `docs/local-agent-guide.md`, `apps/web/public/local-agent-guide.md`, `docs/opendesign-design-stage.md`, `docs/edge-agent-operations.md` as needed

- [ ] Labels: 打开本地构思 / 回传规格; stage output as 产品规格
- [ ] Docs: `flowx-local setup`; brainstorm = clarify → spec.md → confirm → submit
- [ ] Commit: `feat(web): present brainstorm output as product spec`

---

### Task 6: Verify

- [ ] `pnpm --filter @flowx-ai/local test`
- [ ] `pnpm --filter flowx-web exec vitest run` for touched tests
- [ ] Manual: `flowx-local setup cursor --force` in temp HOME

---

## Spec coverage

| Spec item | Task |
| --- | --- |
| Skill content | 1 |
| `setup cursor,codex,od` user-level | 2 |
| `spec.md` + legacy brainstorm.md | 3 |
| MCP descriptions | 4 |
| Platform labels + docs | 5 |
| No platform confirm gate / no chat UI | — (unchanged) |
