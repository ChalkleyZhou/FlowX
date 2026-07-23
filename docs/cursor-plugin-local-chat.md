# Cursor Plugin Local Chat Flow

FlowX local Chat is the lightweight path for Cursor-based development:

```text
Pick requirement or bug -> match local repository -> open Cursor Chat context -> report completion to FlowX
```

The developer keeps working in Cursor Chat/Agent. FlowX keeps the task, workflow, handoff, completion, and review state.

## API endpoints

### `GET /cursor-local/tasks?workspaceId=...`

Returns requirements and bugs that can be started from Cursor.

Each item includes:

- `id`
- `type`: `requirement` or `bug`
- `title`
- `status`
- `priority`
- `scheduleSignal`
- `repository`
- `workflowRunId`
- `eligible`
- `ineligibleReason`

### `POST /cursor-local/handoff`

Creates or starts a local Chat workflow, claims local execution, and returns:

- `workflow`
- `handoff`
- `chatPrompt`
- `taskType`
- `taskId`

Example body:

```json
{
  "taskType": "requirement",
  "taskId": "req-1",
  "repositoryIds": ["repo-1"],
  "aiProvider": "codex"
}
```

For bugs, use `"taskType": "bug"` and the bug id. FlowX creates a `LOCAL_CHAT` run backed by a bug-fix requirement, but it does not auto-run cloud execution.

### `GET /cursor-local/tasks/:type/:id/context`

Returns the raw requirement or bug context for MCP tools or extension previews.

## Relationship to local execution APIs

`/cursor-local/handoff` is a convenience endpoint over the existing local execution path:

1. Create or reuse a `LOCAL_CHAT` workflow.
2. Bootstrap it directly to `EXECUTION_PENDING`.
3. Call `POST /workflow-runs/:id/execution/claim-local`.
4. Return the local handoff plus a Cursor Chat prompt.

When the developer finishes, the extension or MCP server should call:

```text
POST /workflow-runs/:id/execution/complete-local
```

The body can include local Chat metadata:

```json
{
  "pushed": true,
  "implementationSummary": "Implemented CSV export from Cursor Chat.",
  "testResult": "pnpm --filter flowx-web test passed.",
  "diffSummary": "2 files changed",
  "untrackedFiles": [],
  "repositories": [
    {
      "workflowRepositoryId": "wr-1",
      "headSha": "abc123def456",
      "changedFiles": ["src/App.tsx"],
      "patchSummary": "Added export action"
    }
  ]
}
```

If a full FlowX workflow is already in `EXECUTION_PENDING`, Cursor integrations can call `claim-local` directly and do not need to create a new `LOCAL_CHAT` run.

## MCP role

MCP should stay thin:

- `flowx_list_tasks`
- `flowx_get_task_context`
- `flowx_collect_git_report`
- `flowx_report_completion`

FlowX API remains the state source. MCP only bridges Cursor Agent, local Git state, and FlowX reporting.

## Cursor extension from source

Build the extension package:

```bash
pnpm --filter flowx-cursor-extension compile
```

Load it from source in a Cursor-compatible extension host:

```bash
cursor --extensionDevelopmentPath /absolute/path/to/FlowX/apps/cursor-extension
```

In the FlowX activity bar:

1. Run `FlowX: Sign in` and enter the local FlowX URL, for example `http://127.0.0.1:5173`.
2. Complete the normal DingTalk login in the browser.
3. If the account can access multiple DingTalk organizations, select the organization in Cursor.
4. Return to Cursor after the plugin reports that sign-in is complete.
5. Open the local Git repository that matches the FlowX task repository URL.
6. Use `FlowX: Refresh Tasks`.
7. Select a requirement or bug and run `FlowX: Start in Chat`.
8. Paste the copied prompt into Cursor Chat/Agent and implement the change.
9. When the task is ready, run `FlowX: Report Completion` from the active task.

The extension stores the FlowX API URL and session token locally. Users do not need to enter a workspace id; FlowX resolves visible tasks from the signed-in session.

`Start in Chat` writes `.flowx/tasks/<task-id>.md` plus a small JSON handoff snapshot. `Report Completion` collects local Git state, sends `complete-local`, and saves `.flowx/completion-drafts/<workflowRunId>.json` if the API call fails.

### Cursor MCP setup

For normal local execution and OpenDesign use, configure the public local agent instead of pointing Cursor at a monorepo build:

```json
{
  "mcpServers": {
    "flowx": {
      "command": "flowx-local",
      "args": ["mcp"]
    }
  }
}
```

The FlowX Web local-launch flow writes this configuration automatically. The legacy `flowx-mcp` package remains for monorepo contributors and server-side compatibility only; it is not part of the end-user installation path. New Cursor configurations should always use the `flowx-local` command above.

## First-version boundaries

- Do not auto-clone repositories.
- Do not rely on controlling Cursor native Chat internals.
- Do not reimplement the full FlowX state machine in MCP.
- Require explicit user action before push and completion reporting.
