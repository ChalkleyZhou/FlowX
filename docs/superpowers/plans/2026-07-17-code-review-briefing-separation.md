# Code Review / Briefing Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split daily Code Review out of the briefings product so config, schedule, delivery, navigation, and (in P1) data sources are independent; keep daily CR skill-led and leave workflow implementation review for a follow-up plan.

**Architecture:** Extract a Nest `DailyCodeReviewModule` with its own controller, config model, and scheduler. Briefings keep `ProjectBriefingConfig` and `BriefingSchedulerService` only. Delivery targets gain explicit purpose flags. Frontend gets a top-level Code Review nav entry; briefings pages stop owning CR. P1 adds `CodeReviewSource` so CR repo scope no longer requires a `BriefingSource`.

**Tech Stack:** NestJS, Prisma/SQLite, React + Vite, Vitest, existing AI executor + `daily-code-review.prompt.ts`.

**Spec:** `docs/superpowers/specs/2026-07-17-code-review-briefing-separation-design.md`

**Out of scope for this plan (follow-up plans):**
- P2: workflow implementation review skill-assist injection
- P3: skill status ops UX / delivery preview polish beyond what P0–P1 already require

---

## File structure (target)

| Path | Responsibility |
|---|---|
| `apps/api/src/daily-code-review/` | Nest module: controller, services, types, renderer, commits grouping, DTOs, CR scheduler |
| `apps/api/src/daily-code-review/review-skill-discovery.ts` | Server-side review `SKILL.md` discovery before AI call |
| `apps/api/src/briefings/` | Briefings only; scheduler no longer calls CR |
| `apps/api/src/briefings/briefing-commits.ts` | Shared commit collection (imported by CR) |
| `apps/api/src/briefings/briefing-time-window.ts` | Shared date/slot helpers (imported by both schedulers) |
| `apps/api/src/briefings/delivery-targets.service.ts` | Shared senders; filter targets by purpose |
| `prisma/schema.prisma` | `ProjectCodeReviewConfig`, purpose flags on `DeliveryTarget`, `CodeReviewSource` |
| `apps/web/src/pages/CodeReviewsPage.tsx` | CR list + generate |
| `apps/web/src/components/ProjectCodeReviewConfigPanel.tsx` | Independent CR schedule UI |
| `apps/web/src/pages/BriefingsPage.tsx` | Briefings only (no CR tab) |

Keep HTTP paths stable for CR artifacts: `/projects/:id/daily-code-reviews`, `/daily-code-reviews/:id`. Add `/projects/:id/code-review-config` for the new config API.

---

### Task 1: Extract `DailyCodeReviewModule` and controller

**Files:**
- Create: `apps/api/src/daily-code-review/daily-code-review.module.ts`
- Create: `apps/api/src/daily-code-review/daily-code-review.controller.ts`
- Move from `apps/api/src/briefings/`: `daily-code-review.service.ts`, `daily-code-review-ai.service.ts`, `daily-code-review-commits.ts`, `daily-code-review-renderer.ts`, `daily-code-review.types.ts`, `dto/generate-daily-code-review.dto.ts`, and matching `*.spec.ts`
- Modify: `apps/api/src/briefings/briefings.controller.ts` (remove CR routes)
- Modify: `apps/api/src/briefings/briefings.module.ts` (stop providing CR services; import/export only what delivery needs)
- Modify: `apps/api/src/app.module.ts` (register `DailyCodeReviewModule`)
- Test: move/update import paths in all moved specs; update `briefings.controller.spec.ts` if it covered CR routes

- [ ] **Step 1: Move files and fix imports**

Move the CR implementation files into `apps/api/src/daily-code-review/`. Update relative imports to shared briefing helpers:

```ts
import { collectDailyCommits } from '../briefings/briefing-commits';
import {
  buildSchedulerAuthSession,
  resolveProjectOrganizationId,
  toAiInvocationRecipient,
} from '../briefings/briefing-auth-session';
import { formatBriefingDate, briefingDateWindow } from '../briefings/briefing-time-window';
```

`BriefingsModule` must `exports` any providers CR still needs (`DeliveryTargetsService`, Prisma is global). Prefer importing `BriefingsModule` / a thin shared export over duplicating delivery.

- [ ] **Step 2: Add controller with the existing routes**

```ts
@Controller()
export class DailyCodeReviewController {
  @Get('projects/:id/daily-code-reviews')
  listProjectDailyCodeReviews(@Param('id') projectId: string) { /* ... */ }

  @Post('projects/:id/daily-code-reviews/generate')
  generateProjectDailyCodeReview(/* dto + auth session */) { /* ... */ }

  @Get('daily-code-reviews/:id')
  getDailyCodeReview(@Param('id') id: string) { /* ... */ }

  @Post('daily-code-reviews/:id/send')
  sendDailyCodeReview(@Param('id') id: string) { /* ... */ }
}
```

Remove the same four handlers from `BriefingsController`.

- [ ] **Step 3: Wire module**

```ts
@Module({
  imports: [PrismaModule, /* BriefingsModule or DeliveryTargetsModule as needed */],
  controllers: [DailyCodeReviewController],
  providers: [DailyCodeReviewService, DailyCodeReviewAiService],
  exports: [DailyCodeReviewService],
})
export class DailyCodeReviewModule {}
```

Register in `AppModule`.

- [ ] **Step 4: Run API tests for moved specs**

Run:

```bash
pnpm --filter flowx-api test -- src/daily-code-review src/briefings/briefings.controller.spec.ts
```

Expected: PASS (behavior unchanged; only module boundary changed).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/daily-code-review apps/api/src/briefings apps/api/src/app.module.ts
git commit -m "refactor(api): extract DailyCodeReviewModule from briefings"
```

---

### Task 2: Add independent `ProjectCodeReviewConfig`

**Files:**
- Modify: `prisma/schema.prisma`
- Create migration under `prisma/migrations/`
- Create: `apps/api/src/daily-code-review/dto/upsert-code-review-config.dto.ts`
- Modify: `apps/api/src/daily-code-review/daily-code-review.service.ts` (or new `code-review-config.service.ts`)
- Modify: `apps/api/src/daily-code-review/daily-code-review.controller.ts`
- Modify: `apps/api/src/briefings/briefings.service.ts` (stop exposing CR scheduler fields on briefing config responses if present)
- Modify: `apps/web/src/types.ts`, `apps/web/src/api.ts`
- Test: `apps/api/src/daily-code-review/code-review-config.service.spec.ts` (new)

- [ ] **Step 1: Write failing config tests**

```ts
it('upserts code review config without changing briefing config', async () => {
  await prisma.projectBriefingConfig.create({
    data: { projectId, enabled: true, dailyHour: 22, autoSend: true },
  });

  const cr = await service.upsertProjectConfig(projectId, {
    enabled: true,
    dailyHour: 9,
    autoSend: true,
  });

  expect(cr.enabled).toBe(true);
  expect(cr.dailyHour).toBe(9);

  const briefing = await prisma.projectBriefingConfig.findUniqueOrThrow({ where: { projectId } });
  expect(briefing.enabled).toBe(true);
  expect(briefing.dailyHour).toBe(22);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter flowx-api test -- src/daily-code-review/code-review-config.service.spec.ts`

Expected: FAIL — model/service missing.

- [ ] **Step 3: Add Prisma model and migrate**

```prisma
model ProjectCodeReviewConfig {
  id                       String    @id @default(cuid())
  projectId                String    @unique
  project                  Project   @relation(fields: [projectId], references: [id])
  enabled                  Boolean   @default(false)
  dailyHour                Int       @default(22)
  timezone                 String    @default("Asia/Shanghai")
  autoSend                 Boolean   @default(false)
  lastSchedulerSlot        String?
  lastSchedulerRunAt       DateTime?
  lastSchedulerMessage     String?
  createdAt                DateTime  @default(now())
  updatedAt                DateTime  @updatedAt
}
```

Add `codeReviewConfig ProjectCodeReviewConfig?` on `Project`.

Data migration SQL (same migration or follow-up):

1. Insert `ProjectCodeReviewConfig` for every `ProjectBriefingConfig` row, copying `enabled`, `dailyHour`, `timezone`, `autoSend`, and mapping `lastCodeReviewScheduler*` → `lastScheduler*`.
2. Remove `lastCodeReviewSchedulerSlot`, `lastCodeReviewSchedulerRunAt`, `lastCodeReviewSchedulerMessage` from `ProjectBriefingConfig`.

Run: `pnpm prisma:generate` then apply migration / `db push` as repo convention requires.

- [ ] **Step 4: Implement config API**

Routes:

- `GET /projects/:id/code-review-config`
- `PUT /projects/:id/code-review-config`

DTO fields: `enabled`, `dailyHour` (0–23), `timezone`, `autoSend`.

- [ ] **Step 5: Wire web types/api**

```ts
// types.ts
export interface ProjectCodeReviewConfig {
  id: string;
  projectId: string;
  enabled: boolean;
  dailyHour: number;
  timezone: string;
  autoSend: boolean;
  lastSchedulerSlot?: string | null;
  lastSchedulerRunAt?: string | null;
  lastSchedulerMessage?: string | null;
}

// api.ts
getProjectCodeReviewConfig(projectId: string)
updateProjectCodeReviewConfig(projectId: string, body: Partial<ProjectCodeReviewConfig>)
```

- [ ] **Step 6: Re-run config tests + generate client**

Run:

```bash
pnpm prisma:generate
pnpm --filter flowx-api test -- src/daily-code-review/code-review-config.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(api): add independent ProjectCodeReviewConfig"
```

---

### Task 3: Split schedulers

**Files:**
- Modify: `apps/api/src/briefings/briefing-scheduler.service.ts`
- Modify: `apps/api/src/briefings/briefing-scheduler.service.spec.ts`
- Create: `apps/api/src/daily-code-review/code-review-scheduler.service.ts`
- Create: `apps/api/src/daily-code-review/code-review-scheduler.service.spec.ts`
- Modify: `apps/api/src/daily-code-review/daily-code-review.module.ts`

- [ ] **Step 1: Write failing CR scheduler tests**

Assertions:

1. When only `ProjectCodeReviewConfig.enabled === true`, CR generate+send runs; briefing service is never called.
2. When only briefing config enabled, CR service is never called.
3. CR dedupe uses `ProjectCodeReviewConfig.lastSchedulerSlot`, not briefing’s slot.
4. `FLOWX_CODE_REVIEW_SCHEDULER_DISABLED=true` disables CR scheduler only.
5. `FLOWX_BRIEFING_SCHEDULER_DISABLED=true` disables briefing scheduler only.

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter flowx-api test -- src/daily-code-review/code-review-scheduler.service.spec.ts src/briefings/briefing-scheduler.service.spec.ts`

- [ ] **Step 3: Strip CR from `BriefingSchedulerService`**

`runDueBriefings` must only:

1. Query `projectBriefingConfig` where `enabled: true`
2. Generate + send briefing
3. Record briefing scheduler fields only

Delete all `dailyCodeReviewService` usage and combined messages.

- [ ] **Step 4: Implement `CodeReviewSchedulerService`**

Mirror briefing interval (`5 * 60 * 1000`), but:

```ts
const configs = await prisma.projectCodeReviewConfig.findMany({
  where: { enabled: true },
  include: { project: true },
});
// due check: isBriefingSchedulerDue(now, config.dailyHour)
// skip if config.lastSchedulerSlot === `${date}@${config.dailyHour}`
// generateProjectDailyCodeReview + sendDailyCodeReview
// update ProjectCodeReviewConfig lastScheduler*
```

Env: `FLOWX_CODE_REVIEW_SCHEDULER_DISABLED === 'true'`.

- [ ] **Step 5: Run scheduler specs**

Expected: PASS for both briefing-only and CR-only suites.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(api): run code review schedule independently from briefings"
```

---

### Task 4: Independent delivery purpose on `DeliveryTarget`

**Files:**
- Modify: `prisma/schema.prisma` (`DeliveryTarget`)
- Modify: `apps/api/src/briefings/delivery-targets.service.ts`
- Modify: `apps/api/src/briefings/delivery-targets.service.spec.ts`
- Modify: DTOs for create/update delivery targets
- Modify: `apps/web/src/types.ts`, `DeliveryTargetsPage` / `DeliveryTargetList` UI
- Test: extend delivery specs + web tests if present

- [ ] **Step 1: Failing tests for purpose filtering**

```ts
it('sendBriefing only uses targets with forBriefing', async () => {
  // target A: forBriefing true, forCodeReview false
  // target B: forBriefing false, forCodeReview true
  const result = await service.sendBriefing(briefingId);
  expect(result.targetCount).toBe(1);
});

it('sendDailyCodeReview only uses targets with forCodeReview', async () => {
  const result = await service.sendDailyCodeReview(reviewId);
  expect(result.targetCount).toBe(1);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Schema**

```prisma
model DeliveryTarget {
  // existing fields...
  forBriefing    Boolean @default(true)
  forCodeReview  Boolean @default(true)
}
```

Migration: existing rows keep both `true` (backward compatible).

- [ ] **Step 4: Filter in send methods**

```ts
where: {
  projectId,
  isActive: true,
  forBriefing: true, // in sendBriefing
}
```

```ts
where: {
  projectId,
  isActive: true,
  forCodeReview: true, // in sendDailyCodeReview
}
```

Expose flags on create/update DTO and list responses.

- [ ] **Step 5: UI toggles**

On delivery target create/edit: two checkboxes「用于简报」「用于 Code Review」, default both on. Validation: at least one must be true.

- [ ] **Step 6: Tests PASS + commit**

```bash
git commit -m "feat: allow delivery targets to target briefing and code review independently"
```

---

### Task 5: Server-side review skill discovery gate

**Files:**
- Create: `apps/api/src/daily-code-review/review-skill-discovery.ts`
- Create: `apps/api/src/daily-code-review/review-skill-discovery.spec.ts`
- Modify: `apps/api/src/daily-code-review/daily-code-review-ai.service.ts`
- Modify: `apps/api/src/prompts/daily-code-review.prompt.ts` (still instruct AI to follow the skill; discovery is no longer the only gate)

- [ ] **Step 1: Failing discovery unit tests**

Use a temp directory fixture:

```ts
it('finds .cursor/skills/code-review/SKILL.md', () => {
  const found = findReviewSkill(repoRoot);
  expect(found?.relativePath).toBe('.cursor/skills/code-review/SKILL.md');
});

it('returns null when no review skill exists', () => {
  expect(findReviewSkill(emptyRoot)).toBeNull();
});
```

Matching rules (lock in tests):

- Search roots: `.cursor/skills`, `.agents/skills`, `.claude/skills`
- Accept directories whose folder name or `SKILL.md` frontmatter/description contains `review` (case-insensitive)
- Prefer path containing `code-review` when multiple match
- Return `{ absolutePath, relativePath, content }`

- [ ] **Step 2: Implement `findReviewSkill`**

Pure fs walk; no AI. Keep implementation small and sync.

- [ ] **Step 3: Gate AI in `DailyCodeReviewAiService.reviewUnit`**

Before `executor.reviewDailyChanges`:

```ts
const skill = findReviewSkill(repoLocalPath);
if (!skill) {
  return buildSkippedNoSkillOutput(/* standard hint */);
}
```

Pass `skill.relativePath` / content into the prompt context so the model executes that skill (still skill-led, not platform rubric).

- [ ] **Step 4: Run CR AI + discovery specs**

```bash
pnpm --filter flowx-api test -- src/daily-code-review/review-skill-discovery.spec.ts src/daily-code-review/daily-code-review-ai.service.spec.ts
```

Expected: PASS; missing skill never calls executor (assert mock not called).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(api): discover review skill on disk before daily code review AI"
```

---

### Task 6: Frontend — independent Code Review nav and page

**Files:**
- Create: `apps/web/src/pages/CodeReviewsPage.tsx`
- Create: `apps/web/src/pages/CodeReviewsPage.test.tsx`
- Create: `apps/web/src/components/ProjectCodeReviewConfigPanel.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/pages/BriefingsPage.tsx` + `BriefingsPage.test.tsx`
- Modify: `apps/web/src/components/ProjectBriefingConfigPanel.tsx`
- Modify: `apps/web/src/utils/briefings-page-preferences.ts` (+ test) — remove `code-reviews` view
- Modify: project detail page that hosts briefing config panel — add CR panel beside it

- [ ] **Step 1: Failing web tests**

1. `CodeReviewsPage` lists reviews via `api.listProjectDailyCodeReviews` and can trigger generate.
2. `BriefingsPage` no longer renders Code Review tab / does not call list daily CR on mount.
3. `AppLayout` includes nav item `{ key: '/code-reviews', label: 'Code Review' }`.

- [ ] **Step 2: Implement `CodeReviewsPage`**

Reuse list/table patterns from the current CR view inside `BriefingsPage` (extract markup, do not leave a tab behind). Route: `/code-reviews`. Detail route stays `/daily-code-reviews/:reviewId`.

- [ ] **Step 3: Split config panels**

`ProjectBriefingConfigPanel`:

- Copy mentions only 简报
- Remove `generateCodeReviewToday`
- Description must not say「到点会自动生成简报与每日 Code Review」

`ProjectCodeReviewConfigPanel`:

- Uses `getProjectCodeReviewConfig` / `updateProjectCodeReviewConfig`
- Toggle enables CR schedule only
- Manual「生成今日 Code Review」
- Mentions skill-led behavior and link to review skill docs/hint

- [ ] **Step 4: Run web tests**

```bash
pnpm --filter flowx-web test -- src/pages/BriefingsPage.test.tsx src/pages/CodeReviewsPage.test.tsx src/utils/briefings-page-preferences.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): give Code Review its own nav entry and config panel"
```

---

### Task 7: P1 — `CodeReviewSource` independent repo scope

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `apps/api/src/daily-code-review/code-review-sources.service.ts` (+ controller routes under `/code-review-sources` or nested project routes)
- Modify: `apps/api/src/daily-code-review/daily-code-review.service.ts` (scope commits to CR sources)
- Create: `apps/web/src/pages/CodeReviewSourcesPage.tsx` (or section on settings)
- Modify: `apps/web/src/App.tsx` nav/settings link
- Tests: source CRUD + generate respects CR sources even when briefing sources differ

- [ ] **Step 1: Failing integration-style service test**

Setup:

- Repo A has `BriefingSource` only
- Repo B has `CodeReviewSource` only
- Commits/events exist for both

Assert `generateProjectDailyCodeReview` only reviews Repo B units.

- [ ] **Step 2: Schema**

```prisma
model CodeReviewSource {
  id            String   @id @default(cuid())
  workspaceId   String
  workspace     Workspace @relation(fields: [workspaceId], references: [id])
  repositoryId  String
  repository    Repository @relation(fields: [repositoryId], references: [id])
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([repositoryId])
  @@index([workspaceId])
  @@index([isActive])
}
```

P1 MVP: repository binding for scope (no separate webhook table). Commit evidence comes from existing event store **and/or** repo sync for those repository IDs — generation must not require a `BriefingSource` row.

Migration: for each distinct `repositoryId` that appears in historical `DailyCodeReview.unitsJson` / active projects with CR config enabled, backfill a `CodeReviewSource` when a `BriefingSource` exists for that repo; also allow empty CR sources (manual generate then no-ops / empty run).

- [ ] **Step 3: CRUD API + generate filter**

```ts
const sources = await prisma.codeReviewSource.findMany({
  where: { workspaceId, isActive: true },
});
const allowedRepoIds = new Set(sources.map((s) => s.repositoryId));
// filter collected commits / units to allowedRepoIds
```

If no active CR sources: return empty-run report (or 400 with clear message). Prefer empty-run + status that is not a fake successful review — align with spec「记录空跑结果」.

- [ ] **Step 4: Settings UI**

Settings page to attach workspace repositories as Code Review sources (checkbox list is fine). Link from Code Review page empty state.

- [ ] **Step 5: Tests PASS + commit**

```bash
git commit -m "feat: add CodeReviewSource so CR repo scope is independent of briefing sources"
```

---

### Task 8: Docs, env naming, final verification

**Files:**
- Modify: `AGENTS.md`, `apps/api/AGENTS.md`, `apps/web/AGENTS.md` (mention `daily-code-review` module / nav)
- Modify: `apps/api/src/daily-code-review/daily-code-review-ai.service.ts` — prefer `FLOWX_CODE_REVIEW_AI_DISABLED` (keep reading old `FLOWX_BRIEFING_AI_*` as fallback one release)
- Skim `docs/user-manual.md` — add a short Code Review vs 简报 note if the manual mentions bundled behavior

- [ ] **Step 1: Update agent guides directory sections**

- [ ] **Step 2: Full verification**

```bash
pnpm --filter flowx-api test
pnpm --filter flowx-web test
pnpm check
```

Expected: all PASS.

- [ ] **Step 3: Manual smoke checklist**

1. Enable briefing only → only briefing generates/sends at hour.
2. Enable CR only → only CR generates/sends.
3. Delivery target with only `forCodeReview` → briefing send targetCount 0; CR send works.
4. Repo without review skill → `SKIPPED_NO_SKILL` without pretending success.
5. Briefings page has no CR tab; `/code-reviews` works.

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: document separated Code Review module boundaries"
```

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| CR independent module/API/nav | 1, 6 |
| Independent schedule/config switches | 2, 3 |
| Briefing does not trigger CR | 3, 6 |
| Parallel delivery, body not mixed | 4 (already separate content; purpose flags enforce independent targets) |
| Skill-led daily CR / skip without skill | 5 |
| Independent data sources | 7 |
| No new CR fields on `ProjectBriefingConfig` | 2 (removes CR scheduler columns) |
| Workflow skill-assist | **Out of scope** → P2 plan |
| Ops polish P3 | **Out of scope** → P3 plan |

## Self-review notes

- No TBD steps left for P0/P1; open schema choices are locked: new `ProjectCodeReviewConfig`, purpose booleans on `DeliveryTarget`, `CodeReviewSource` as repo-scope MVP without duplicate webhooks.
- HTTP paths for review artifacts stay `/daily-code-reviews` to avoid breaking bookmarks; config uses `/code-review-config`.
- Shared commit/time helpers remain under `briefings/` for this plan to avoid a third extract; revisit only if imports become circular.
