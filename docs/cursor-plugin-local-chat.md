# Cursor Plugin Local Chat Flow

FlowX local Chat is the lightweight path for Cursor-based development:

```text
Pick execution item -> match local repository -> open Cursor Chat context -> report completion to FlowX
```

The developer keeps working in Cursor Chat/Agent. FlowX keeps the task, workflow, handoff, completion, and review state.

## API endpoints

### `GET /cursor-local/tasks?workspaceId=...`

Returns confirmed, local capable execution items whose parent WorkItem workflow has reached `EXECUTION_PENDING`.

Each item includes:

- `id`: execution item id
- `workItemId`
- `kind`: `REQUIREMENT` or `ISSUE`
- `title`: execution item title
- `workItemTitle`
- `status`
- `priority`
- `scheduleSignal`
- `repository`
- `workflowRunId`
- `eligible`
- `ineligibleReason`

### `POST /cursor-local/handoff`

Claims the selected execution item, starts its execution session, and returns:

- `workflow`
- `handoff`
- `chatPrompt`
- `executionItemId`
- `workItemId`

Example body:

```json
{
  "executionItemId": "execution-item-1",
  "claimKey": "cursor-device-claim-1",
  "aiProvider": "codex"
}
```

### `GET /cursor-local/execution-items/:executionItemId/context`

Returns the WorkItem and execution item context for MCP tools or extension previews.

## Relationship to local execution APIs

`/cursor-local/handoff` is the execution-item entry point:

1. Validate that the execution plan is confirmed and linked to a workflow.
2. Claim the selected execution item with a user and idempotency key.
3. Create the execution session and transition the workflow to `EXECUTION_RUNNING`.
4. Return the local handoff plus a Cursor Chat prompt.

When the developer finishes, the extension or MCP server calls:

```text
POST /execution-sessions/:executionSessionId/complete
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

For a WorkItem with multiple execution items, each Cursor or local Agent session claims its own execution item. The workflow enters review only after all required execution items complete.

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
7. Select an execution item and run `FlowX: Start in Chat`.
8. Paste the copied prompt into Cursor Chat/Agent and implement the change.
9. When the task is ready, run `FlowX: Report Completion` from the active task.

The extension stores the FlowX API URL and session token locally. Users do not need to enter a workspace id; FlowX resolves visible tasks from the signed-in session.

`Start in Chat` writes `.flowx/tasks/<execution-item-id>.md` plus a small JSON handoff snapshot. `Report Completion` collects local Git state and submits it with the handoff `executionSessionId`; network failures are reported for retry after reconnection.

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

The FlowX Web local-launch flow writes this configuration automatically. `flowx-local mcp` is the single FlowX MCP implementation for end users and monorepo contributors.

## First-version boundaries

- Do not auto-clone repositories.
- Do not rely on controlling Cursor native Chat internals.
- Do not reimplement the full FlowX state machine in MCP.
- Require explicit user action before push and completion reporting.
