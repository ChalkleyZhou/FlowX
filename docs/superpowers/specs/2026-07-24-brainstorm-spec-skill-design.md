# Brainstorm → Spec Skill Design

**Date:** 2026-07-24  
**Status:** Approved for planning  
**Scope:** Change workflow「产品构思」so that local Cursor/OpenDesign agents clarify requirements in multi-turn dialogue, produce a confirmed `spec.md`, then submit once via MCP. Platform displays only the final spec and advances to design without a second confirmation UI.

## Goal

Brainstorm should feel like Superpowers / OpenSpec:

1. Multi-turn clarification when the requirement is unclear  
2. Final artifact is a product **spec** (`spec.md`), not a chat log  
3. User confirms the spec in the IDE before MCP submit  
4. Platform stores/shows that markdown only, then moves to `DESIGN_PENDING`

## Decisions

| Topic | Choice |
| --- | --- |
| Dialogue location | Cursor Agent (including when driven via OpenDesign) |
| Platform summary of chat | None |
| After IDE confirm + MCP submit | Advance to design immediately (no platform confirm gate) |
| Process enforcement | Skill-driven (no MCP `userConfirmed` hard field in this change) |
| Skill install scope | User-level once, not per git repo by default |
| Install UX | Explicit `flowx-local setup [targets]` |

## Skill content (process)

User-level Skill `flowx-brainstorm-spec` must instruct the agent to:

1. Pull context via MCP (`flowx_get_active_design_session`, `flowx_get_brainstorm_handoff`)  
2. Clarify goals, scope, non-goals, acceptance criteria, and risks before writing a formal spec  
3. Write **`spec.md`** with a structure close to Superpowers/OpenSpec (background, goals, non-goals, requirements, acceptance, closed open questions)  
4. Present the full spec to the user and ask for confirmation  
5. Call `flowx_submit_brainstorm` **only after** the user confirms; `markdown` = full `spec.md` body  
6. Never submit unconfirmed drafts or conversation transcripts as the spec  

Task-specific ids and handoff data stay in MCP/session files, not in the Skill text.

## How the Skill is discovered

Cursor (and OpenDesign → Cursor Agent) reads **user-level** skills.

### Install command

```bash
flowx-local setup                 # default: cursor,codex,od
flowx-local setup cursor
flowx-local setup cursor,codex
flowx-local setup cursor,codex,od
```

| Target | Write path (indicative) |
| --- | --- |
| `cursor` | `~/.cursor/skills/flowx-brainstorm-spec/SKILL.md` |
| `codex` | `~/.agents/skills/flowx-brainstorm-spec/SKILL.md` (or Codex’s documented user skills root) |
| `od` | Same discoverable user skills root Open Design / Cursor-via-OD actually scans; if identical to Cursor, reuse `cursor` |

Rules:

- Default: create if missing; do not overwrite user-edited Skill unless `--force`  
- Print which paths were written / skipped  
- **`serve` does not silently install skills**; docs tell users to run `setup` before first local brainstorm  

Rationale: the brainstorm *process* is global; per-task context is session/MCP. Avoid copying the same Skill into every repository.

## Local session / adapter changes

- Prefer writing/reading **`spec.md`** in the design session directory (and in the user’s project when the agent creates it there)  
- Keep reading legacy **`brainstorm.md`** for `design-submit` / adapter compatibility  
- Update OpenDesign session `INSTRUCTIONS.md` to the clarify → spec → confirm → submit flow  
- Ship template under `packages/flowx-local/templates/flowx-brainstorm-spec/SKILL.md` (included in npm `files`)

## MCP and API

- `flowx_submit_brainstorm` contract unchanged (markdown string)  
- Tool descriptions: submit only after user confirmed `spec.md`  
- Completion still completes the brainstorm stage and transitions `BRAINSTORM_PENDING` → `DESIGN_PENDING`  
- No new platform waiting-confirmation status for brainstorm in this change  

## Platform UI / docs

- Stage output labeled as product **规格 / spec** (markdown body)  
- Soften copy that implies one-shot generation; prefer「打开本地构思」「回传规格」  
- Update local-agent guide / OpenDesign docs: run `flowx-local setup`, then serve; brainstorm = clarify then `spec.md`  
- Cloud `runBrainstorm` path not required in this change (optional follow-up)

## Non-goals

- Platform chat UI or dialogue transcript  
- MCP hard `userConfirmed` field  
- Per-repo Skill install as the primary path  
- Full OpenSpec multi-file change directories  

## Risks

- Skill discipline is soft; agents may still submit early (acceptable for v1; hard gate is a later option)  
- Users on older `@flowx-ai/local` need a new npm release that includes `setup` + template  
- `od` skill path must be verified against Open Design’s real Cursor skill roots at implementation time  

## Verification

- `flowx-local setup cursor` creates user-level Skill; second run is no-op without `--force`  
- Template text includes clarify → spec.md → confirm → submit  
- Adapter/instructions mention `spec.md`; legacy `brainstorm.md` still works  
- Submit still advances workflow to design; Web shows markdown as spec  
- Docs describe setup targets and the new brainstorm expectation  
