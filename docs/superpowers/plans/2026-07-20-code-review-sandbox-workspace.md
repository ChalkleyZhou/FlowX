# Code Review Sandbox Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Daily Code Review a per-workspace sandbox under `.flowx-data/code-review/...` so CR can fetch/checkout without touching development clones, pass name→path maps for skills, and review whole repos via skill even when there are no commits that day.

**Architecture:** Add `ensureCodeReviewSandbox` + path helpers on `RepositorySyncService` (or a thin `CodeReviewSandboxService`). Point CR generate/build units at sandbox `localPath`. Extend `DailyCodeReviewUnitInput` with `workspaceRepositoryMap` and update the daily-code-review prompt for skill-led whole-tree review with read-only conventions. Keep default “all workspace repos / opt-out via inactive CodeReviewSource”.

**Tech Stack:** NestJS, TypeScript, Vitest, existing git helpers in `repository-sync.service.ts`, `daily-code-review.prompt.ts`, Codex/Cursor/Mock executors.

**Spec:** `docs/superpowers/specs/2026-07-20-code-review-sandbox-workspace-design.md`

**Out of scope:** bare/mirror unification, FS read-only hardening, workflow clone changes, UI sync-status (P2), GC (P3).

---

## File structure (target)

| Path | Responsibility |
|---|---|
| `apps/api/src/workspaces/repository-sync.service.ts` | `getCodeReviewStoragePath`, `ensureCodeReviewSandbox` (clone/fetch/checkout in CR root) |
| `apps/api/src/workspaces/repository-sync.service.spec.ts` | Path + sandbox behavior tests |
| `apps/api/src/common/types.ts` | `workspaceRepositoryMap` on `DailyCodeReviewUnitInput` |
| `apps/api/src/daily-code-review/daily-code-review.service.ts` | Build units per included repo via sandbox; attach map; optional commit context |
| `apps/api/src/daily-code-review/daily-code-review.service.spec.ts` | Sandbox path used; no main-tree ensure; units without commits |
| `apps/api/src/prompts/daily-code-review.prompt.ts` | Whole-repo + skill + map + no-write rules |
| `apps/api/src/ai/codex-ai.executor.ts` | Prompt builder includes map + read-only instructions |
| `apps/api/AGENTS.md` / root `AGENTS.md` | Mention CR sandbox root / env |

---

### Task 1: CR sandbox path + `ensureCodeReviewSandbox`

**Files:**
- Modify: `apps/api/src/workspaces/repository-sync.service.ts`
- Modify: `apps/api/src/workspaces/repository-sync.service.spec.ts`

- [ ] **Step 1: Write failing tests for path resolution**

```ts
it('resolves code review sandbox path under code-review/workspaces', () => {
  // call a package-visible helper or ensureCodeReviewSandbox with mocked fs/git
  // expect path to contain `code-review/workspaces/{workspaceId}/repositories/`
  // and `{slug}-{id8}` suffix matching existing slugify rules
});

it('uses CODE_REVIEW_REPOS_ROOT when set', () => {
  process.env.CODE_REVIEW_REPOS_ROOT = '/tmp/cr-root';
  // expect join('/tmp/cr-root', workspaceId, 'repositories', ...)
});
```

Also assert `ensureCodeReviewSandbox` does **not** write `Repository.localPath` (main workspace path unchanged).

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter flowx-api test -- src/workspaces/repository-sync.service.spec.ts`

- [ ] **Step 3: Implement path helpers + ensureCodeReviewSandbox**

```ts
private getCodeReviewStoragePath(workspaceId: string) {
  const root = process.env.CODE_REVIEW_REPOS_ROOT?.trim()
    ? process.env.CODE_REVIEW_REPOS_ROOT.trim()
    : join(process.cwd(), '.flowx-data', 'code-review', 'workspaces');
  return join(root, workspaceId, 'repositories');
}

private resolveCodeReviewRepositoryPath(workspaceId, repositoryId, repositoryName) {
  return join(
    this.getCodeReviewStoragePath(workspaceId),
    `${this.slugify(repositoryName)}-${repositoryId.slice(0, 8)}`,
  );
}

async ensureCodeReviewSandbox(
  repository: { id; workspaceId; name; url; defaultBranch; currentBranch; /* no need to mutate prisma localPath */ },
  branch: string,
): Promise<{ localPath: string; branch: string; syncStatus: 'READY' | 'ERROR'; syncError?: string }>
```

Behavior (mirror `syncRepository` git steps but target CR path):

1. Compute sandbox path; `mkdir` parents.
2. If no `.git`: `git clone <url> <sandboxPath>` (use existing remote auth helpers).
3. `fetch --prune`.
4. Checkout `branch` (create tracking as existing helpers do).
5. Return sandbox `localPath`; **do not** update `repository.localPath` in Prisma.

Reuse private git helpers (`runGit`, auth, stale lock) from the same service.

- [ ] **Step 4: Tests PASS + commit**

```bash
git commit -m "feat(api): add Code Review sandbox clone path and ensure helper"
```

---

### Task 2: Wire Daily CR generate to sandbox paths

**Files:**
- Modify: `apps/api/src/daily-code-review/daily-code-review.service.ts`
- Modify: `apps/api/src/daily-code-review/daily-code-review.service.spec.ts`

- [ ] **Step 1: Failing tests**

1. When generating, `ensureCodeReviewSandbox` is called (mock) for each included repo; `ensureRepositoryReadyForReview` is **not** called.
2. Unit `localPath` equals sandbox path returned by the mock.
3. Included repo with **zero commits** still produces a review unit (AI `reviewUnit` called), not omitted solely for empty groups.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Change unit construction**

Replace “only groups from commits” as the sole unit source:

```ts
// For each allowedRepoId:
const branch = repo.currentBranch || repo.defaultBranch || 'main';
const sandbox = await this.repositorySyncService.ensureCodeReviewSandbox(repo, branch);
// collect optional commits/diff for context (existing event/git fallback)
// always push a unit { repositoryId, repositoryName, localPath: sandbox.localPath, ref: branch, commits, commitDiffBundle? }
```

Keep evidence failure units when sandbox sync fails.

Inject/mock `ensureCodeReviewSandbox` in the service constructor tests (extend the existing sync service mock).

- [ ] **Step 4: Tests PASS + commit**

```bash
git commit -m "feat(api): run daily Code Review against sandbox repository paths"
```

---

### Task 3: `workspaceRepositoryMap` on unit input

**Files:**
- Modify: `apps/api/src/common/types.ts`
- Modify: `apps/api/src/daily-code-review/daily-code-review.service.ts`
- Modify: `apps/api/src/daily-code-review/daily-code-review.service.spec.ts`
- Modify: `apps/api/src/daily-code-review/daily-code-review-ai.service.spec.ts` (fixtures if needed)

- [ ] **Step 1: Failing test**

```ts
expect(reviewUnit).toHaveBeenCalledWith(
  expect.objectContaining({
    unit: expect.objectContaining({
      workspaceRepositoryMap: expect.arrayContaining([
        expect.objectContaining({
          name: 'repo-a',
          repositoryId: 'repo-a',
          localPath: expect.stringContaining('code-review'),
        }),
      ]),
    }),
  }),
);
```

Map must include **all successfully sandboxed included repos** for that generate run (same list on every unit).

- [ ] **Step 2: Extend type**

```ts
export interface DailyCodeReviewRepositoryMapEntry {
  name: string;
  repositoryId: string;
  localPath: string;
}

export interface DailyCodeReviewUnitInput {
  // existing fields...
  workspaceRepositoryMap?: DailyCodeReviewRepositoryMapEntry[];
}
```

- [ ] **Step 3: Populate map in generate/build payload before `reviewUnit`**

- [ ] **Step 4: Tests PASS + commit**

```bash
git commit -m "feat(api): pass workspace repository name map into Code Review units"
```

---

### Task 4: Prompt + executor — skill-led whole repo, read-only convention

**Files:**
- Modify: `apps/api/src/prompts/daily-code-review.prompt.ts`
- Modify: `apps/api/src/ai/codex-ai.executor.ts` (`buildDailyCodeReviewPrompt`)
- Modify: any prompt contract/spec if present
- Test: executor or AI service spec asserting prompt contains key phrases

- [ ] **Step 1: Update prompt contract text**

System/user must state:

1. Review the **current repository tree** at `localPath` according to the provided review skill (primary).
2. Optional recent commits/diff are **context only**; lack of commits is not a reason to skip.
3. Resolve other repos via `workspaceRepositoryMap` by **name**, never by slug-id folder names.
4. **Do not** modify business files, commit, or push.
5. Prefer reading files under the provided paths; keep existing executor cwd allowlist behavior (`repositoryDirs` should include unit `localPath` and optionally other map paths for multi-repo skills).

Bump prompt `version` string.

- [ ] **Step 2: Render map + rules in `buildDailyCodeReviewPrompt`**

Include JSON dump of `workspaceRepositoryMap` and skill content (already partially present via `discoveredSkill`).

- [ ] **Step 3: Expand `repositoryDirs` for Codex/Cursor**

```ts
const dirs = [
  input.unit.localPath,
  ...(input.unit.workspaceRepositoryMap?.map((e) => e.localPath) ?? []),
].filter(Boolean);
```

- [ ] **Step 4: Tests PASS + commit**

```bash
git commit -m "feat(api): make daily Code Review skill-led whole-repo with read-only prompt"
```

---

### Task 5: Docs + verification

**Files:**
- Modify: `AGENTS.md`, `apps/api/AGENTS.md` (CR sandbox root / `CODE_REVIEW_REPOS_ROOT`)
- Optional one-line in `docs/docker-deployment.md` if volume layout is documented

- [ ] **Step 1: Document directory layout and env**

- [ ] **Step 2: Full API tests**

```bash
pnpm --filter flowx-api test
pnpm --filter flowx-api build
```

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: document Code Review sandbox workspace root"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| Separate CR disk root | 1 |
| CR does not checkout main workspace tree | 2 |
| Name → path map for skills | 3 |
| Whole-repo skill review; no commit not skip | 2, 4 |
| Read-only by prompt convention | 4 |
| Default all-repo scope / exclusions | Already shipped; keep intact |
| FS read-only / GC / UI status | Out of scope |

## Self-review notes

- Locked env name: `CODE_REVIEW_REPOS_ROOT` defaulting to `.flowx-data/code-review/workspaces`.
- `ensureRepositoryReadyForReview` remains for any non-CR callers; CR must not call it.
- No Prisma migration required for P0/P1.
