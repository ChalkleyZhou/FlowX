# Local Execution Handoff

FlowX supports **local execution** for the EXECUTION stage: the server tells developers which Git branch to use; work happens in the developer's own clone (not a server sandbox). After commit and push, the UI or API records the result and advances the workflow toward AI review.

Cursor local Chat uses this same local execution contract with a shorter task picker and Chat prompt handoff. See [cursor-plugin-local-chat.md](./cursor-plugin-local-chat.md).

## Flow

1. Confirm the technical plan (`PLAN_CONFIRMED` → `EXECUTION_PENDING`).
2. Call **`POST /workflow-runs/:id/execution/claim-local`** (or use **本地执行** in the web UI).
3. Use the returned **handoff** (or **`GET /workflow-runs/:id/execution/local-handoff`**) for each repository:
   - `workingBranch` — FlowX workflow branch (same naming as cloud execution)
   - `checkout` — suggested `git fetch` / `checkout -B` / `push` commands
   - `suggestedCommitMessage` — commit message hint
4. On your machine: clone/fetch, checkout the working branch from `baseBranch`, develop, commit, push.
5. Call **`POST /workflow-runs/:id/execution/complete-local`** with per-repo `headSha`, `changedFiles`, and `pushed: true`.
6. If the repository has a registered **remote URL**, the API verifies the branch tip with `git ls-remote` before completing.
7. Workflow moves to review (same path as cloud execution). An **execution HTML artifact** may be written under `.flowx-data` (see [workflow-artifacts.md](./workflow-artifacts.md)).

Cancel with **`POST /workflow-runs/:id/execution/cancel-local`** to return to `EXECUTION_PENDING`.

Cloud **`POST /workflow-runs/:id/execution/run`** is unchanged.

## Branch naming

`WorkflowRepository.workingBranch` follows:

```text
flowx/work/{requirementSlug≤24}/{workflowRunIdLast8}
```

Example: `flowx/work/local-handoff/ocal-001` for run id ending in `ocal-001`.

## API: `complete-local` body

```json
{
  "pushed": true,
  "implementationSummary": "Optional local Chat implementation summary",
  "testResult": "Optional test result summary",
  "diffSummary": "Optional diff summary",
  "untrackedFiles": [],
  "repositories": [
    {
      "workflowRepositoryId": "wr-1",
      "headSha": "abc123def456...",
      "changedFiles": ["src/App.tsx", "src/api.ts"],
      "patchSummary": "Optional per-repo summary"
    }
  ]
}
```

Rules:

- Every `workflowRepositoryId` must belong to the run.
- If any repository has a non-empty `url`, **`pushed` must be `true`**.
- When `pushed` is true and `url` is set, **`headSha` must match** the remote tip of `workingBranch` (full or short SHA prefix).

## Artifacts

- **Plan** (for context): `GET /workflow-runs/:id/artifacts/plan`
- **Execution report** (after complete): `GET /workflow-runs/:id/artifacts/execution`

## Related code

- Handoff builder: `apps/api/src/workflow/workflow-local-handoff.ts`
- Remote verify: `apps/api/src/workflow/workflow-git-remote.service.ts`
- Orchestration: `apps/api/src/workflow/workflow.service.ts` (`claimLocalExecution`, `completeLocalExecution`, …)
- Web UI: `apps/web/src/pages/WorkflowRunDetailPage.tsx`
