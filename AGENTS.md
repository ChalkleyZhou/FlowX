# FlowX Agent Rules

## Goal

Keep AI changes small, testable, and easy to review.

## Rules

- Do not manually edit generated Prisma client artifacts.
- Prefer adding or updating tests before changing workflow orchestration rules.
- When changing `apps/api/src/workflow`, `apps/api/src/common/workflow-state-machine.ts`, or `apps/api/src/requirements/requirements.service.ts`, run `pnpm --filter flowx-api test`.
- When changing `apps/web/src/api.ts` or page data-loading behavior, run `pnpm --filter flowx-web test`.
- Before handing off a change, run `pnpm check`.
- Keep one branch focused on one subsystem unless the task explicitly spans multiple subsystems.
- Treat `prisma/schema.prisma`, workflow orchestration, ideation orchestration (`apps/api/src/requirements/`), and API boundary code as high-risk areas that need narrow diffs.
