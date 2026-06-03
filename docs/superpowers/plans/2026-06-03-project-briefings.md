# Project Briefings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-level GitLab daily briefings to FlowX while keeping briefing-specific GitLab, event, generation, and delivery data decoupled from the core `Repository` model.

**Architecture:** Add a new NestJS `BriefingsModule` that owns briefing sources, GitLab event ingestion, rendering, delivery, and project briefing config while reading FlowX `Project`, `Workspace`, and `Repository` records to resolve scope. Add FlowX Web pages and API helpers for sources, delivery targets, project config, briefing history, and briefing details. Migrate pure logic from `/Users/chalkley/rokid/daily-briefing` into FlowX-native files and cover behavior with Vitest.

**Tech Stack:** NestJS, TypeScript, Prisma, SQLite, Vitest, React, Vite, Tailwind, Radix/shadcn UI, lucide-react.

---

## File Structure

API files to create:

- `apps/api/src/briefings/briefings.module.ts`: Nest module wiring.
- `apps/api/src/briefings/briefing-sources.controller.ts`: source CRUD and webhook endpoint.
- `apps/api/src/briefings/briefings.controller.ts`: project config, briefing list/detail, generation, send endpoints.
- `apps/api/src/briefings/delivery-targets.controller.ts`: delivery target CRUD endpoints.
- `apps/api/src/briefings/briefings.service.ts`: project config, generation, listing, detail, send orchestration.
- `apps/api/src/briefings/briefing-sources.service.ts`: source CRUD and webhook persistence.
- `apps/api/src/briefings/delivery-targets.service.ts`: delivery target CRUD and delivery log writes.
- `apps/api/src/briefings/gitlab-events.ts`: GitLab payload normalization and dedupe key builder.
- `apps/api/src/briefings/briefing-renderer.ts`: event aggregation and Markdown/HTML rendering.
- `apps/api/src/briefings/delivery-senders.ts`: SMTP and DingTalk robot sender functions.
- `apps/api/src/briefings/briefing-scheduler.service.ts`: due project briefing scan and auto-send.
- `apps/api/src/briefings/dto/*.ts`: create/update/generate DTOs with class-validator.
- `apps/api/src/briefings/*.spec.ts`: pure logic and service tests.

API files to modify:

- `prisma/schema.prisma`: add briefing models and relations.
- `apps/api/src/app.module.ts`: import `BriefingsModule`.
- `apps/api/package.json`: add `nodemailer` dependency if not already present.

Web files to create:

- `apps/web/src/pages/BriefingsPage.tsx`: project/date filters, manual generation, history table.
- `apps/web/src/pages/BriefingDetailPage.tsx`: rendered briefing, scope, delivery logs, resend action.
- `apps/web/src/pages/BriefingSourcesPage.tsx`: workspace/repository source management.
- `apps/web/src/pages/DeliveryTargetsPage.tsx`: workspace-scoped delivery target management.
- `apps/web/src/components/ProjectBriefingConfigPanel.tsx`: project-level briefing settings and generate action.
- `apps/web/src/pages/BriefingsPage.test.tsx`
- `apps/web/src/pages/BriefingDetailPage.test.tsx`

Web files to modify:

- `apps/web/src/api.ts`: add typed briefing API helpers.
- `apps/web/src/types.ts`: add briefing types.
- `apps/web/src/App.tsx`: add routes.
- `apps/web/src/pages/ProjectDetailPage.tsx`: mount `ProjectBriefingConfigPanel`.
- `apps/web/src/components/AppLayout.tsx`: add navigation entries.
- `apps/web/src/api.test.ts`: cover new API helpers.

---

### Task 1: Migrate Pure Briefing Logic

**Files:**
- Create: `apps/api/src/briefings/gitlab-events.ts`
- Create: `apps/api/src/briefings/briefing-renderer.ts`
- Create: `apps/api/src/briefings/delivery-senders.ts`
- Test: `apps/api/src/briefings/gitlab-events.spec.ts`
- Test: `apps/api/src/briefings/briefing-renderer.spec.ts`
- Test: `apps/api/src/briefings/delivery-senders.spec.ts`

- [ ] **Step 1: Write failing normalize/dedupe tests**

Create `apps/api/src/briefings/gitlab-events.spec.ts` with push, merge request, pipeline, and duplicate-key expectations ported from `daily-briefing`.

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/gitlab-events.spec.ts
```

Expected: fail because `gitlab-events.ts` does not exist.

- [ ] **Step 2: Implement GitLab normalization and dedupe**

Create `apps/api/src/briefings/gitlab-events.ts` with:

- `GitlabEventType`
- `NormalizedGitlabEvent`
- `normalizeGitlabPayload(payload)`
- `buildDedupeKey(event)`

Keep behavior compatible with `daily-briefing/libs/gitlab-events`.

- [ ] **Step 3: Verify GitLab event tests pass**

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/gitlab-events.spec.ts
```

Expected: pass.

- [ ] **Step 4: Write failing renderer tests**

Create `apps/api/src/briefings/briefing-renderer.spec.ts` covering event counts, failed pipeline count, escaped HTML, and empty sections.

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/briefing-renderer.spec.ts
```

Expected: fail because renderer exports do not exist.

- [ ] **Step 5: Implement renderer**

Create `apps/api/src/briefings/briefing-renderer.ts` with:

- `aggregateEvents(events)`
- `renderBriefingMarkdown({ date, events })`
- `renderBriefingHtml({ date, events })`

Start deterministic and non-AI.

- [ ] **Step 6: Verify renderer tests pass**

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/briefing-renderer.spec.ts
```

Expected: pass.

- [ ] **Step 7: Write failing delivery sender tests**

Create `apps/api/src/briefings/delivery-senders.spec.ts` for DingTalk robot signing, DingTalk error handling, and email transport payload.

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/delivery-senders.spec.ts
```

Expected: fail because sender exports do not exist.

- [ ] **Step 8: Implement sender helpers**

Create `apps/api/src/briefings/delivery-senders.ts` with:

- `signDingTalkRobotUrl(webhookUrl, secret?, now?)`
- `sendDingTalkMarkdown(input)`
- `sendEmail(input)`

Use dynamic dependency injection for `fetchImpl` and `transportFactory` so tests do not hit the network.

- [ ] **Step 9: Verify task tests**

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/gitlab-events.spec.ts apps/api/src/briefings/briefing-renderer.spec.ts apps/api/src/briefings/delivery-senders.spec.ts
```

Expected: pass.

Commit:

```bash
git add apps/api/src/briefings
git commit -m "feat(briefings): add GitLab briefing primitives"
```

---

### Task 2: Add Prisma Models

**Files:**
- Modify: `prisma/schema.prisma`
- Create/Update: Prisma generated client through command output only

- [ ] **Step 1: Add schema relations and models**

Add:

- `Workspace.briefingSources`
- `Workspace.deliveryTargets`
- `Workspace.briefings`
- `Project.briefingConfig`
- `Project.briefings`
- `Repository.briefingSources`
- `Repository.gitlabEvents`
- `BriefingSource`
- `GitlabEvent`
- `ProjectBriefingConfig`
- `Briefing`
- `DeliveryTarget`
- `DeliveryLog`

Use `Json` for `rawPayload`, `normalizedPayload`, `scope`, and `providerResponse`.

- [ ] **Step 2: Generate Prisma client**

Run:

```bash
pnpm --filter flowx-api prisma:generate
```

Expected: Prisma client generation succeeds.

- [ ] **Step 3: Build API to catch schema type issues**

Run:

```bash
pnpm --filter flowx-api build
```

Expected: fail only on missing service code references if Task 3 has not started, otherwise pass.

Commit:

```bash
git add prisma/schema.prisma package.json pnpm-lock.yaml
git commit -m "feat(briefings): add briefing data model"
```

---

### Task 3: Add Backend Sources, Webhook, Config, Generation, And Delivery

**Files:**
- Create: `apps/api/src/briefings/briefings.module.ts`
- Create: `apps/api/src/briefings/briefing-sources.controller.ts`
- Create: `apps/api/src/briefings/briefing-sources.service.ts`
- Create: `apps/api/src/briefings/briefings.controller.ts`
- Create: `apps/api/src/briefings/briefings.service.ts`
- Create: `apps/api/src/briefings/delivery-targets.controller.ts`
- Create: `apps/api/src/briefings/delivery-targets.service.ts`
- Create: `apps/api/src/briefings/briefing-scheduler.service.ts`
- Create: `apps/api/src/briefings/dto/create-briefing-source.dto.ts`
- Create: `apps/api/src/briefings/dto/update-briefing-source.dto.ts`
- Create: `apps/api/src/briefings/dto/upsert-project-briefing-config.dto.ts`
- Create: `apps/api/src/briefings/dto/generate-briefing.dto.ts`
- Create: `apps/api/src/briefings/dto/create-delivery-target.dto.ts`
- Create: `apps/api/src/briefings/dto/update-delivery-target.dto.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/briefings/briefing-sources.service.spec.ts`
- Test: `apps/api/src/briefings/briefings.service.spec.ts`
- Test: `apps/api/src/briefings/delivery-targets.service.spec.ts`

- [ ] **Step 1: Write failing source CRUD and webhook service tests**

Cover:

- source creation rejects repositories outside workspace
- invalid webhook token is rejected
- inactive source is rejected
- first webhook stores event
- second identical webhook returns duplicate

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/briefing-sources.service.spec.ts
```

Expected: fail because service does not exist.

- [ ] **Step 2: Implement source DTOs and service**

Implement CRUD with Prisma, workspace/repository validation, secret trimming, and webhook persistence.

- [ ] **Step 3: Verify source tests pass**

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/briefing-sources.service.spec.ts
```

Expected: pass.

- [ ] **Step 4: Write failing generation/config tests**

Cover:

- default config is returned for projects without a saved config
- config upsert persists enabled/hour/timezone/autoSend
- project generation reads enabled workspace sources
- existing briefing is returned unless regenerate is true
- generated scope contains repository and source ids

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/briefings.service.spec.ts
```

Expected: fail because service methods do not exist.

- [ ] **Step 5: Implement config, listing, detail, generation, and send orchestration**

Implement `BriefingsService` with project lookup, date-window helper, stable scope builder, rendering calls, delivery handoff, and safe errors.

- [ ] **Step 6: Verify generation/config tests pass**

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/briefings.service.spec.ts
```

Expected: pass.

- [ ] **Step 7: Write failing delivery target tests**

Cover:

- workspace-scoped target CRUD
- deleting a target deletes logs first
- send writes success and failed logs
- at least one success updates `Briefing.sentAt`

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/delivery-targets.service.spec.ts
```

Expected: fail because service does not exist.

- [ ] **Step 8: Implement delivery target service and controllers**

Add controllers for source, target, and briefing routes. Mark webhook route public with existing auth public decorator if needed for unauthenticated GitLab calls.

- [ ] **Step 9: Wire module into app**

Import `BriefingsModule` in `apps/api/src/app.module.ts`.

- [ ] **Step 10: Verify backend tests**

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings
pnpm --filter flowx-api build
```

Expected: pass.

Commit:

```bash
git add apps/api/src/briefings apps/api/src/app.module.ts
git commit -m "feat(briefings): add briefing API"
```

---

### Task 4: Add Frontend Types And API Helpers

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

- [ ] **Step 1: Write failing API helper tests**

Add tests for:

- `getBriefingSources`
- `createBriefingSource`
- `updateBriefingSource`
- `deleteBriefingSource`
- `getProjectBriefingConfig`
- `updateProjectBriefingConfig`
- `getProjectBriefings`
- `generateProjectBriefing`
- `getBriefing`
- `sendBriefing`
- `getDeliveryTargets`
- `createDeliveryTarget`
- `updateDeliveryTarget`
- `deleteDeliveryTarget`

Run:

```bash
pnpm --filter flowx-web test -- apps/web/src/api.test.ts
```

Expected: fail because helper methods do not exist.

- [ ] **Step 2: Add frontend types and API helpers**

Add `BriefingSource`, `ProjectBriefingConfig`, `Briefing`, `DeliveryTarget`, and `DeliveryLog` to `types.ts`, then add request helpers to `api.ts`.

- [ ] **Step 3: Verify web API tests pass**

Run:

```bash
pnpm --filter flowx-web test -- apps/web/src/api.test.ts
```

Expected: pass.

Commit:

```bash
git add apps/web/src/types.ts apps/web/src/api.ts apps/web/src/api.test.ts
git commit -m "feat(web): add briefing API client"
```

---

### Task 5: Add Frontend Pages And Project Panel

**Files:**
- Create: `apps/web/src/pages/BriefingsPage.tsx`
- Create: `apps/web/src/pages/BriefingDetailPage.tsx`
- Create: `apps/web/src/pages/BriefingSourcesPage.tsx`
- Create: `apps/web/src/pages/DeliveryTargetsPage.tsx`
- Create: `apps/web/src/components/ProjectBriefingConfigPanel.tsx`
- Test: `apps/web/src/pages/BriefingsPage.test.tsx`
- Test: `apps/web/src/pages/BriefingDetailPage.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/ProjectDetailPage.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`

- [ ] **Step 1: Write failing page tests**

Cover:

- briefings page loads projects and shows empty state
- manual generation calls API and refreshes history
- detail page renders HTML content and delivery logs
- resend action calls API

Run:

```bash
pnpm --filter flowx-web test -- apps/web/src/pages/BriefingsPage.test.tsx apps/web/src/pages/BriefingDetailPage.test.tsx
```

Expected: fail because pages do not exist.

- [ ] **Step 2: Implement pages and panel**

Use existing FlowX components: `PageHeader`, `SectionHeader`, `EmptyState`, `MetricCard`, `Button`, `Card`, `Input`, `Select`, `Textarea`, `Badge`, `Spinner`, and toast.

- [ ] **Step 3: Add routes and navigation**

Add:

- `/briefings`
- `/briefings/:briefingId`
- `/settings/briefing-sources`
- `/settings/delivery-targets`

Mount `ProjectBriefingConfigPanel` on project detail.

- [ ] **Step 4: Verify web tests and build**

Run:

```bash
pnpm --filter flowx-web test
pnpm --filter flowx-web build
```

Expected: pass.

Commit:

```bash
git add apps/web/src
git commit -m "feat(web): add briefing management UI"
```

---

### Task 6: Add Scheduler And Final Verification

**Files:**
- Modify: `apps/api/src/briefings/briefing-scheduler.service.ts`
- Modify: `apps/api/src/briefings/briefings.module.ts`
- Test: `apps/api/src/briefings/briefing-scheduler.service.spec.ts`
- Modify docs if new environment variables are required.

- [ ] **Step 1: Write failing scheduler tests**

Cover:

- due enabled config generates a briefing
- disabled config is skipped
- autoSend calls send after generation
- duplicate due scan does not create duplicate briefings

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/briefing-scheduler.service.spec.ts
```

Expected: fail because scheduler behavior is missing.

- [ ] **Step 2: Implement conservative scheduler**

Use an interval-based service or existing scheduling pattern in FlowX. Keep the core "find due configs" logic pure enough to test directly.

- [ ] **Step 3: Verify API tests and build**

Run:

```bash
pnpm --filter flowx-api test
pnpm --filter flowx-api build
```

Expected: pass.

- [ ] **Step 4: Run final repository verification**

Run:

```bash
pnpm check
```

Expected: build and tests pass.

Commit:

```bash
git add apps/api/src/briefings docs README.md
git commit -m "feat(briefings): schedule project briefings"
```

---

## Self-Review

- Spec coverage: data model, webhook ingestion, generation, delivery, scheduler, API, UI, tests, and migration strategy are represented.
- Scope choice: first version implements workspace-derived source scope for project briefings. Project-specific repository narrowing remains out of scope, matching the approved design.
- Placeholder scan: no `TBD`, `TODO`, or open-ended "add tests later" steps are present.
- Type consistency: plan consistently uses `BriefingSource`, `GitlabEvent`, `ProjectBriefingConfig`, `Briefing`, `DeliveryTarget`, and `DeliveryLog`.

