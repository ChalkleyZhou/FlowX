# Local Execution Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Human gate:** Approve `docs/superpowers/specs/2026-06-03-local-execution-handoff-design.md` (v2) before starting.

**Goal:**串联「本地执行」：告知 workflow 工作分支 → 用户在本地 clone 切分支、提交、推送 → `complete-local` 回写工作流并进入审查。

**Architecture:** `claim-local` returns a **handoff** payload (`workingBranch`, git command hints). `complete-local` accepts per-repo `headSha` + `changedFiles` (+ `pushed`); server optionally verifies tip via `git ls-remote` on registered repo URL. No server-side sandbox editing for local. Extract `finalizeExecutionSuccess` shared with cloud `runExecution`. Execution HTML artifacts like plan slice.

**Tech Stack:** NestJS, Vitest, React, existing `WorkflowRepository.workingBranch`, `WorkflowArtifactService`.

**Design spec:** `docs/superpowers/specs/2026-06-03-local-execution-handoff-design.md` (v2 — developer workspace)

**Out of scope:** VS Code extension, MCP package, auto git on user machine from server.

---

### Task 1: Handoff builder + DTOs

**Files:**
- Create: `apps/api/src/workflow/dto/complete-local-execution.dto.ts`
- Create: `apps/api/src/workflow/workflow-local-handoff.ts`
- Create: `apps/api/src/workflow/workflow-local-handoff.spec.ts`

- [ ] **Step 1: Failing tests for `buildLocalHandoff(workflow)`**

Assert:
- `repositories[0].workingBranch` matches `flowx/work/...`
- `checkout.checkout` contains `workingBranch`
- `suggestedCommitMessage` contains workflow id snippet

- [ ] **Step 2: Implement `buildLocalHandoff`**

Input: workflow with `workflowRepositories`, requirement, plan (from `resolveConfirmedPlan`), tasks, manifest plan paths.

Generate checkout hints:

```ts
checkout: {
  fetch: 'git fetch origin',
  checkout: `git checkout -B ${workingBranch} origin/${baseBranch}`,
  push: `git push -u origin ${workingBranch}`,
}
```

Use `buildWorkflowCommitMessage` or new `buildLocalCommitMessageHint(workflow)` for suggested message.

- [ ] **Step 3: DTO with class-validator**

```ts
class CompleteLocalRepositoryDto {
  @IsString() workflowRepositoryId: string;
  @IsString() headSha: string;
  @IsArray() @IsString({ each: true }) changedFiles: string[];
  @IsOptional() @IsString() patchSummary?: string;
}
class CompleteLocalExecutionDto {
  @ValidateNested({ each: true }) repositories: CompleteLocalRepositoryDto[];
  @IsBoolean() pushed: boolean;
}
```

- [ ] **Step 4: Run tests — PASS**

`pnpm --filter flowx-api test -- src/workflow/workflow-local-handoff.spec.ts`

- [ ] **Step 5: Commit**

---

### Task 2: Remote branch verify

**Files:**
- Create: `apps/api/src/workflow/workflow-git-remote.service.ts`
- Create: `apps/api/src/workflow/workflow-git-remote.service.spec.ts`
- Modify: `apps/api/src/workflow/workflow.module.ts`

- [ ] **Step 1: Test `verifyBranchTip(url, branch, headSha)`**

Mock `execFile` or use dry-run: when ls-remote returns matching sha → true; mismatch → false.

- [ ] **Step 2: Implement with `git ls-remote origin refs/heads/{branch}`**

Parse first column; compare to `headSha` (allow full/short sha prefix match).

- [ ] **Step 3: Register provider**

- [ ] **Step 4: Commit**

---

### Task 3: Execution artifacts + output builder

**Files:**
- Create: `apps/api/src/workflow/workflow-artifact.execution.render.ts`
- Modify: `apps/api/src/workflow/workflow-artifact.service.ts`
- Modify: `apps/api/src/workflow/workflow-artifact.service.spec.ts`
- Create: `apps/api/src/workflow/workflow-local-execution-output.ts`

- [ ] **Step 1: `buildExecutionOutputFromLocalReport(handoff, dto)`**

Produces `ExecuteTaskOutput`:

- `patchSummary`: joined per-repo summaries or single user summary
- `changedFiles`: union of all paths
- `codeChanges`: map each file to `{ file, changeType: 'update', summary }`
- `diffArtifacts`: per repo `{ repository, branch: workingBranch, localPath: '', diffStat: '', diffText: '', untrackedFiles: [] }` — empty diffText for local

- [ ] **Step 2: `writeExecutionArtifact` + render HTML** (branch table, SHAs, pushed flag)

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit**

---

### Task 4: Extract `finalizeExecutionSuccess`

**Files:**
- Modify: `apps/api/src/workflow/workflow.service.ts`

(Same as prior plan — extract cloud completion transaction; cloud `runExecution` unchanged behavior.)

- [ ] **Step 1–5:** Extract, test, commit `refactor(workflow): share execution finalization`

---

### Task 5: `claim-local` + `GET local-handoff`

**Files:**
- Modify: `apps/api/src/workflow/workflow.service.ts`
- Modify: `apps/api/src/workflow/workflow.controller.ts`
- Create: `apps/api/src/workflow/workflow-local-execution.spec.ts`

- [ ] **Step 1: `claimLocalExecution`**

- Preconditions: `EXECUTION_PENDING`, plan resolvable
- Transition → `EXECUTION_RUNNING`
- Stage RUNNING, `input: { executor: 'LOCAL', claimedAt, claimedByUserId, handoffSnapshot }`
- **Return** `{ workflow: updated, handoff: buildLocalHandoff(...) }` (not just workflow)

- [ ] **Step 2: `getLocalHandoff(id)`**

Allowed when LOCAL RUNNING (or also EXECUTION_PENDING after plan? — spec: RUNNING only)

- [ ] **Step 3: Routes**

```ts
@Post(':id/execution/claim-local')
@Get(':id/execution/local-handoff')
```

Place `local-handoff` before `:id` if needed.

- [ ] **Step 4: Tests for claim returns handoff.repositories[0].workingBranch**

- [ ] **Step 5: Commit**

---

### Task 6: `complete-local` + `cancel-local`

**Files:**
- Modify: `apps/api/src/workflow/workflow.service.ts`
- Modify: `apps/api/src/workflow/workflow.controller.ts`
- Modify: `apps/api/src/workflow/workflow-local-execution.spec.ts`

- [ ] **Step 1: `completeLocalExecution(id, dto, session)`**

1. Validate LOCAL RUNNING
2. If `dto.pushed`, for each repo with `url`, `verifyBranchTip`
3. If verify fails → `400`「请先 push 到 {workingBranch}」
4. `buildExecutionOutputFromLocalReport`
5. `finalizeExecutionSuccess(..., { executor: 'LOCAL' })`
6. `writeExecutionArtifact`
7. Return updated workflow + handoff summary

Require `dto.pushed === true` when any repo has remote url (product rule).

- [ ] **Step 2: `cancelLocalExecution`**

- [ ] **Step 3: Routes**

```ts
@Post(':id/execution/complete-local')
@Post(':id/execution/cancel-local')
```

- [ ] **Step 4: Tests** (mock remote verify success/failure)

- [ ] **Step 5: Commit**

---

### Task 7: `GET artifacts/execution`

**Files:**
- Modify: `workflow.service.ts`, `workflow.controller.ts`

- [ ] **Step 1: `readExecutionArtifactHtml` + route** (mirror plan)

- [ ] **Step 2: Commit**

---

### Task 8: Web — handoff panel + complete form

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/types.ts` (LocalHandoff types)
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`

- [ ] **Step 1: API types + methods**

```ts
claimLocalExecution(id) => { workflow, handoff }
getLocalHandoff(id)
completeLocalExecution(id, body)
cancelLocalExecution(id)
fetchExecutionArtifact(id)
```

- [ ] **Step 2: Handoff panel (EXECUTION + LOCAL)**

Show for each repo:
- 工作分支 `workingBranch` (copy button)
- 基线 `baseBranch`
- 复制：fetch / checkout / push commands from `handoff.repositories[].checkout`
- Checklist text: 切分支 → 开发 → 提交 → 推送

Store `handoff` in state from claim response or `getLocalHandoff` on load.

- [ ] **Step 3: Complete dialog**

Per-repo fields: headSha, changedFiles (textarea), patchSummary; global pushed checkbox (required).

Call `completeLocalExecution` → toast → reload workflow.

- [ ] **Step 4: Buttons**

`EXECUTION_PENDING`: 云端执行 | 本地执行  
`EXECUTION_RUNNING` + LOCAL: 完成本地执行 | 取消本地执行

- [ ] **Step 5: Execution report iframe** when `_artifact` on execution output

- [ ] **Step 6: Tests**

- [ ] **Step 7: Commit**

---

### Task 9: Docs + `pnpm check`

**Files:**
- Create: `docs/local-execution-handoff.md`
- Modify: `docs/workflow-artifacts.md`

Document串联流程、分支命名、`complete-local` body、push 校验。

- [ ] **Step 1: Write docs**

- [ ] **Step 2: `pnpm check`**

- [ ] **Step 3: Commit**

---

## Follow-up

| Item | Notes |
|------|-------|
| MCP tools | Pre-fill complete body from local `git` |
| Extension | Run git in workspace, one-click complete |
| Bind `Repository` to workspace folder | Validate changedFiles paths |
| CLI helper | `flowx local complete --run id --repo .` |

---

## Spec coverage (v2)

| Requirement | Task |
|-------------|------|
| Show workflow branch | 1, 5, 8 |
| Local clone flow (not sandbox) | 6, docs 9 |
| commit + push + update workflow | 2, 6 |
| complete-local body | 1, 6 |
| Artifacts | 3, 7 |
| Cloud unchanged | 4 |

**Do not implement until approved.**
