# OpenDesign MCP Context Pull Design

Date: 2026-07-22

## Goal

Designers choose their project directory inside Open Design. FlowX does not force
`~/.flowx/design-sessions/` as the working directory. Context is pulled and results
are submitted through `flowx-mcp`.

## Flow

1. Web creates/refreshes a LOCAL_DESIGN session and issues a one-time ticket.
2. `flowx-local` redeems the ticket, stores short-lived credentials in
   `~/.flowx/active-design.json`, and opens Open Design.app.
3. Designer opens their own project in Open Design.
4. Agent calls `flowx_get_active_design_session` / `flowx_get_design_handoff`.
5. Agent designs, then calls `flowx_submit_design` with a DesignCompletionReport.

## MCP tools

- `flowx_get_active_design_session` — read local active design credentials/meta
- `flowx_get_design_handoff` — GET `/workflow-runs/:id/design/local-handoff`
- `flowx_submit_design` — POST `/execution-sessions/:id/design/complete`

## Non-goals

- Changing Open Design itself
- Requiring `import-folder` into Open Design
