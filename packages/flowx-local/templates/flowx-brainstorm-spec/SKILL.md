# FlowX brainstorm → product spec

Use this Skill when FlowX asks you to run **local product brainstorm / 产品构思** (OpenDesign or Cursor via FlowX MCP).

## Goal

Produce a confirmed product **`spec.md`** (Superpowers / OpenSpec style), then submit it to FlowX. Do **not** treat brainstorm as a one-shot dump of chat notes.

## Required process

1. **Pull context** via FlowX MCP:
   - `flowx_get_active_design_session`
   - `flowx_get_brainstorm_handoff` (omit ids when an active session exists)
2. **Clarify first.** If goals, scope, non-goals, acceptance criteria, or risks are unclear, ask the user multi-turn questions. Do not write a formal spec until clarification is good enough.
3. **Write `spec.md`** in the user’s project (preferred) with sections similar to:
   - Background
   - Goals
   - Non-goals
   - Requirements
   - Acceptance criteria
   - Open questions (only if still open; prefer closing them in dialogue first)
4. **Show the full `spec.md` to the user** and explicitly ask whether it is correct / complete.
5. **Only after the user confirms**, call `flowx_submit_brainstorm` with `report = { idempotencyKey, markdown }` where `markdown` is the full confirmed `spec.md` body.
6. **Never** submit unconfirmed drafts, conversation transcripts, or placeholder fluff as the spec.

## Notes

- Workflow / session ids come from MCP active session or handoff — do not hardcode them in this Skill.
- After a successful submit, FlowX advances to the design stage; the platform displays the submitted markdown as the product spec.
