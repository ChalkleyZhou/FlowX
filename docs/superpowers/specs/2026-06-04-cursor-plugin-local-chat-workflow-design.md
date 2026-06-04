# Cursor Plugin Local Chat Workflow Design

## Goal

FlowX should support a lightweight local development loop inside Cursor:

1. Pick a FlowX requirement or bug.
2. Verify the current local repository matches the task.
3. Hand the task context to Cursor Chat/Agent.
4. Let the developer iterate in Cursor Chat until the change is ready.
5. Report the final implementation back to FlowX.

The local experience should feel like using Cursor normally. FlowX provides task context and delivery bookkeeping, not a second heavyweight workflow UI inside the editor.

## Design Principles

- Keep the Cursor plugin flow short: pick task, start chat, report completion.
- Reuse the developer's existing local repository. Do not auto-clone repositories in the first version.
- Reuse Cursor Chat/Agent as the primary development interface.
- Keep FlowX API as the organization-level state source for requirements, bugs, workflow history, review artifacts, and delivery status.
- Use MCP as a thin bridge for context and reporting, not as a replacement for FlowX API persistence.
- Avoid exposing the full FlowX stage chain inside Cursor. The plugin should present a local developer workflow, while FlowX can keep detailed stage records behind the scenes.

## Architecture

```text
Cursor Extension
  - Task picker sidebar
  - Local repository matcher
  - Chat handoff prompt generator
  - Completion reporter

FlowX MCP Server
  - Reads task context from FlowX API
  - Exposes context tools to Cursor Agent
  - Collects local git/test reports
  - Sends completion reports back to FlowX API

Cursor Chat/Agent
  - Main implementation workspace
  - Developer-driven conversation, edits, terminal commands, tests, and review

FlowX API
  - Requirements and bugs
  - Workflow/state history
  - Execution results
  - Review and human confirmation
```

The extension may register the FlowX MCP server for the current workspace when Cursor supports this reliably. If direct registration is not available in the user's Cursor version, the first version can fall back to documented `.cursor/mcp.json` setup plus copy/open actions.

## User Flow

### 1. Select Task

The Cursor sidebar shows FlowX requirements and bugs that are eligible for local development. Each item shows:

- Title
- Type: requirement or bug
- Status
- Bound repository
- Priority or schedule signal, when available

The user selects one item and clicks `Start in Chat`.

### 2. Match Local Repository

The extension inspects the current Cursor workspace:

- Git root path
- `origin` remote URL
- Current branch
- Dirty working tree status

It compares the local repository with the repository bound to the FlowX task.

If the repository matches, the flow continues.

If it does not match, the plugin asks the user to open the correct local repository. The first version does not clone automatically, because local directory choice, credentials, and workspace layout are user-owned concerns.

### 3. Handoff to Cursor Chat

The plugin creates a concise chat handoff package:

- FlowX task id and workflow id, if one exists
- Requirement or bug title
- Description
- Acceptance criteria or expected fix behavior
- Relevant repository and branch guidance
- Suggested tests or checks
- Completion instructions for reporting back to FlowX

The ideal action is `Send to Cursor Chat`. If Cursor does not provide a stable API for inserting into the native chat input, the fallback is:

- Copy prompt to clipboard
- Open a generated Markdown task file under `.flowx/tasks/<task-id>.md`
- Show an action to open Cursor Chat manually

### 4. Develop in Cursor Chat

The developer works in Cursor Chat/Agent as usual:

- Discuss implementation
- Ask for clarification
- Let Agent edit files
- Run tests
- Review diffs
- Iterate on follow-up prompts

FlowX does not force intermediate confirmations in the local plugin. The chat is the working area.

MCP tools may be available to Cursor Agent:

- `flowx_get_task_context`
- `flowx_get_acceptance_criteria`
- `flowx_report_progress`
- `flowx_update_plan`
- `flowx_collect_git_status`
- `flowx_submit_completion`

These tools are helpful but not mandatory for the first version. The minimum viable loop can work with a generated prompt and a final completion report.

### 5. Report Completion

When the developer is satisfied, they click `Report to FlowX`.

The plugin/MCP server collects:

- Current branch
- Head SHA
- Changed files
- Diff summary
- Untracked files, if any
- User-entered implementation summary
- User-entered test result
- Push status

The user can choose whether to push from the plugin. If they choose not to push, FlowX should record a local completion draft but should not mark remote verification as complete.

If pushed, FlowX verifies the remote branch tip and records the execution output. The workflow then moves into review or human confirmation according to FlowX's existing rules.

## Workflow Mapping

The local Cursor plugin should expose only:

```text
Pick Task -> Chat Implementation -> Report Completion
```

Internally, FlowX may map this to existing stages:

- Requirement/bug selection maps to workflow creation or lookup.
- Chat handoff maps to local execution claim or a new lightweight local handoff stage.
- Completion report maps to execution output.
- Optional review maps to existing AI review and human review stages.

The plugin should not require users to manually step through brainstorm, design, demo, task split, and technical plan before opening chat. Those stages remain valuable for full FlowX workflows, but the local Cursor plugin is optimized for fast developer execution.

## Requirement vs Bug Behavior

Requirements and bugs share the same local shell flow, but the generated chat context differs.

Requirement prompt focus:

- Product intent
- Acceptance criteria
- Suggested implementation scope
- UI/demo note only when relevant

Bug prompt focus:

- Observed behavior
- Expected behavior
- Reproduction steps
- Suspected area
- Regression checks

This keeps the plugin simple while still giving Cursor Agent task-specific guidance.

## MCP Scope

MCP is useful for two things:

1. Supplying FlowX context to Cursor Agent.
2. Sending local reports back to FlowX.

MCP should not own canonical workflow state. FlowX API remains the state source.

The first MCP tool set should stay small:

- `flowx_list_tasks`
- `flowx_get_task_context`
- `flowx_collect_git_report`
- `flowx_report_completion`

More tools can be added later if Cursor Agent usage proves valuable.

## Error Handling

- No workspace open: ask the user to open a local repository.
- Repository mismatch: show expected remote and current remote.
- Dirty working tree before start: warn the user and allow continuing.
- No changed files on completion: require confirmation before reporting.
- Push failed: keep the local report draft and show the git error.
- Remote verification failed: tell the user which branch and SHA FlowX expected.
- FlowX API unavailable: store a local completion draft and allow retry.

## Security

- Store FlowX API token in the extension secret store.
- Do not persist source code or full diffs in extension settings.
- Do not auto-run destructive git commands.
- Do not auto-clone repositories in the first version.
- Require explicit user action before push and FlowX completion.

## Testing Strategy

Extension tests:

- Task list rendering
- Repository remote matching
- Prompt generation
- Completion payload generation
- Error states for no workspace and repository mismatch

MCP/server tests:

- FlowX API client calls
- Git report collection
- Completion report validation
- Retry behavior for API failures

FlowX API tests:

- Create or find workflow from requirement/bug for local chat flow
- Accept local completion report
- Verify pushed branch tip
- Preserve existing full workflow behavior

Manual verification:

- Install extension in Cursor.
- Open a matching local repository.
- Select requirement.
- Generate chat prompt.
- Make a small code change through Cursor Chat.
- Report completion to FlowX.
- Confirm FlowX Web shows the execution result.

## Non-Goals For First Version

- Full local clone management.
- Replacing FlowX Web for planning and review-heavy workflows.
- Automatically controlling Cursor native chat internals if no stable API exists.
- Reimplementing the full FlowX stage engine in MCP.
- Background autonomous development without the developer using Cursor Chat.

## Open Implementation Notes

- If Cursor chat insertion is not stable through extension APIs, use clipboard plus generated task Markdown as the reliable first version.
- If Cursor MCP programmatic registration is available, register the FlowX MCP server from the extension. Otherwise document `.cursor/mcp.json`.
- Existing FlowX local execution APIs can be reused for completion reporting, but they may need a thinner endpoint that accepts a chat-driven local completion without requiring the full plan-confirmed stage chain.
