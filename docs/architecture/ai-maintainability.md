# AI Maintainability Guide

## Why this exists

FlowX is designed to evolve through repeated AI-assisted iterations. That only stays maintainable if the repo tells future agents where the sharp edges are and how to validate changes before handoff.

## High-risk zones

- `apps/api/src/workflow`
- `apps/api/src/common/workflow-state-machine.ts`
- `apps/web/src/api.ts`
- `prisma/schema.prisma`

## Change protocol

1. Clarify which subsystem is changing before editing code.
2. Add or update the nearest automated test first when touching high-risk logic.
3. Make the smallest change that satisfies the requirement.
4. Run the narrow validation command for the touched subsystem.
5. Run `pnpm check` before handoff or merge.

## Validation map

- Workflow and orchestration changes: `pnpm --filter flowx-api test`
- Frontend API boundary changes: `pnpm --filter flowx-web test`
- Cross-cutting verification: `pnpm check`

## Refactor triggers

Refactor before adding features when any of the following becomes true:

- One file carries more than one business responsibility.
- A single change needs simultaneous edits to orchestration logic and persistence details.
- A future agent would need to understand multiple business concepts to safely change one file.

## Expected AI workflow

- Start from the closest existing module instead of creating parallel abstractions.
- Prefer table-driven rules and pure helpers for business invariants.
- Keep diffs narrow and explicit in high-risk files.
- Leave behind tests or docs whenever a new rule is introduced.
