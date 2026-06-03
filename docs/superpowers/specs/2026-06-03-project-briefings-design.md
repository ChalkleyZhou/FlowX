# Project Briefings Design

## Summary

Move the capabilities from `/Users/chalkley/rokid/daily-briefing` into FlowX as a first-class but decoupled project briefing module.

The briefing feature should follow FlowX projects: a FlowX `Project` belongs to one `Workspace`, and project briefings use the enabled GitLab briefing sources attached to repositories in that workspace. Briefing-specific GitLab configuration, event storage, generation, and delivery remain owned by the new briefing module instead of being embedded into the core `Repository` model.

This design intentionally does not migrate the separate Next.js app, separate user model, or separate DingTalk login flow from `daily-briefing`. FlowX keeps its existing React/Vite web app and authentication system. The migrated functionality includes GitLab webhook ingestion, event deduplication, daily aggregation, Markdown/HTML rendering, manual and scheduled generation, email delivery, DingTalk robot delivery, delivery logs, resend workflows, and management UI.

## Confirmed Decisions

- Briefings are project-level.
- A project uses the repositories from its existing workspace.
- Briefing GitLab settings are decoupled from `Repository`.
- The briefing module may read `Workspace`, `Project`, and `Repository` data to resolve scope.
- The first implementation migrates all `daily-briefing` product capabilities except the separate app shell and duplicate login system.
- Project-level briefing configuration controls enablement, daily generation time, timezone, and automatic delivery.
- GitLab webhook handling stays fast: validate, normalize, dedupe, store, and return.
- Briefing generation and delivery are separate, retryable workflows.

## Existing Context

FlowX already has these relevant primitives:

- `Workspace`
- `Project`
- `Repository`
- repository sync and local working copies
- React/Vite management console
- NestJS + Prisma API
- authentication and DingTalk-related organization login
- schedule-related modules and pages

`daily-briefing` currently provides:

- GitLab project configuration
- GitLab webhook endpoint
- event normalization and dedupe helpers
- stored raw and normalized events
- deterministic daily Markdown/HTML briefing rendering
- manual briefing generation
- scheduled daily generation
- email delivery
- DingTalk robot delivery
- delivery targets and delivery logs
- management UI for projects, delivery targets, briefings, and briefing details

The clean migration path is to preserve the behavior but remap ownership to FlowX concepts.

## Architecture

Add a new FlowX API module:

- `apps/api/src/briefings`

Suggested internal areas:

- `briefing-sources`: GitLab source configuration and webhook URL metadata.
- `gitlab-events`: normalize, dedupe, and store webhook events.
- `rendering`: aggregate events and render Markdown/HTML briefings.
- `delivery`: email and DingTalk robot sender adapters plus delivery logs.
- `scheduler`: project-level daily generation orchestration.

The module owns briefing-specific persistence and APIs. It reads FlowX core data through Prisma relations or narrow service methods, but core workspace, project, and repository services do not depend on the briefing module.

FlowX Web adds briefing pages under the existing protected layout. The migrated UI should reuse FlowX components, `apps/web/src/api.ts`, `apps/web/src/types.ts`, and the existing shadcn/Radix/Tailwind style rather than bringing over the Next.js app from `daily-briefing`.

## Data Model

### `BriefingSource`

Represents a GitLab webhook source for one FlowX repository.

Fields:

- `id`
- `workspaceId`
- `repositoryId`
- `provider` default `gitlab`
- `gitlabProjectId`
- `pathWithNamespace`
- `webhookSecret`
- `isActive`
- `createdAt`
- `updatedAt`

Relations:

- belongs to `Workspace`
- belongs to `Repository`
- has many `GitlabEvent`

Indexes and constraints:

- unique `repositoryId + provider + gitlabProjectId`
- index `workspaceId`
- index `repositoryId`
- index `isActive`

The source stores briefing integration settings. `Repository` remains a generic code repository record.

### `GitlabEvent`

Stores raw and normalized GitLab webhook data.

Fields:

- `id`
- `briefingSourceId`
- `workspaceId`
- `repositoryId`
- `gitlabProjectId`
- `eventType`
- `objectKind`
- `actorName`
- `actorUsername`
- `occurredAt`
- `dedupeKey`
- `rawPayload`
- `normalizedPayload`
- `createdAt`

Indexes and constraints:

- unique `dedupeKey`
- index `briefingSourceId + occurredAt`
- index `workspaceId + occurredAt`
- index `repositoryId + occurredAt`
- index `eventType + occurredAt`

The normalized payload should keep the `daily-briefing` shape so aggregation and rendering remain deterministic.

### `ProjectBriefingConfig`

Controls project-level briefing behavior.

Fields:

- `id`
- `projectId`
- `enabled`
- `dailyHour`
- `timezone`
- `autoSend`
- `createdAt`
- `updatedAt`

Relations:

- one-to-one with `Project`

The default timezone should be `Asia/Shanghai`. The default hour should match the current `daily-briefing` default, `18`.

### `Briefing`

Stores generated briefing content for a FlowX project and date.

Fields:

- `id`
- `projectId`
- `workspaceId`
- `date`
- `scope`
- `status`
- `markdownContent`
- `htmlContent`
- `eventCount`
- `generatedAt`
- `sentAt`
- `errorMessage`
- `createdAt`
- `updatedAt`

Indexes and constraints:

- index `projectId + date`
- index `workspaceId + date`
- unique `projectId + date + scope`

`scope` should be a stable JSON string or JSON value that records date, project id, workspace id, repository ids, and briefing source ids. This preserves what was included even if repository/source settings change later.

### `DeliveryTarget`

Represents a destination for briefing delivery.

Fields:

- `id`
- `workspaceId`
- `type`
- `name`
- `emailAddress`
- `dingtalkWebhookUrl`
- `dingtalkSecret`
- `isActive`
- `createdAt`
- `updatedAt`

Supported initial types:

- `EMAIL`
- `DINGTALK_ROBOT`

Reserved type:

- `DINGTALK_APP`

Targets should be scoped to a workspace so each project can use destinations from its workspace. A later iteration can add explicit project-to-target selection if needed.

### `DeliveryLog`

Records each send attempt.

Fields:

- `id`
- `briefingId`
- `deliveryTargetId`
- `channel`
- `status`
- `errorMessage`
- `providerResponse`
- `sentAt`
- `createdAt`

Indexes:

- `briefingId`
- `deliveryTargetId`

Failed delivery attempts should remain visible and retryable.

## Scope Resolution

Project briefing generation resolves events this way:

1. Load the FlowX `Project`.
2. Read the project's `workspaceId`.
3. Load active `BriefingSource` records for repositories in that workspace.
4. Use their `repositoryId` and `briefingSourceId` values to query `GitlabEvent` rows in the selected date window.
5. Render one project briefing from those events.

This means projects do not need direct repository associations for the first version. If FlowX later adds `ProjectRepository`, the briefing module can narrow the source query without changing webhook storage.

## GitLab Webhook Handling

Add a source-specific webhook endpoint such as:

- `POST /briefing-sources/:id/gitlab-webhook`

Request behavior:

1. Load the `BriefingSource`.
2. Reject inactive or missing sources.
3. Validate `X-Gitlab-Token` against `BriefingSource.webhookSecret`.
4. Normalize the GitLab payload.
5. Build a dedupe key.
6. Insert `GitlabEvent`.
7. On unique dedupe collision, return `{ duplicate: true }`.
8. Otherwise return `{ duplicate: false, id }`.

The webhook route should not generate briefings or send notifications.

Supported event categories in the first migration:

- push
- tag push
- merge request
- issue
- note/comment
- pipeline
- release where GitLab sends the configured payload shape
- unsupported event fallback

## Briefing Generation

Add manual generation:

- `POST /projects/:id/briefings/generate`

Input:

- `date`
- optional `regenerate`

Behavior:

1. Resolve the project workspace.
2. Build the date window in the configured timezone.
3. Load enabled sources in the workspace.
4. Load normalized events for the date window.
5. Render Markdown and HTML.
6. Store or return an existing briefing unless `regenerate` is true.

Rendering starts as deterministic templates migrated from `daily-briefing`:

- overview
- code activity
- merge requests
- issues
- pipelines
- tags and releases
- notable comments

AI summarization is intentionally out of scope for the first migration.

## Delivery

Add delivery APIs:

- `GET /delivery-targets?workspaceId=...`
- `POST /delivery-targets`
- `PATCH /delivery-targets/:id`
- `DELETE /delivery-targets/:id`
- `POST /briefings/:id/send`

Delivery behavior:

1. Load the briefing.
2. Load active workspace delivery targets.
3. Send to each target.
4. Write one `DeliveryLog` per attempt.
5. Mark `Briefing.sentAt` if at least one target succeeds.

Email delivery should use SMTP environment variables:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`

DingTalk robot delivery should support optional signing secrets and Markdown messages.

Do not leak webhook URLs, DingTalk secrets, SMTP passwords, or tokens in errors returned to the UI.

## Scheduling

Add scheduled project briefing generation through the briefing module, integrated with FlowX's existing scheduling infrastructure where practical.

Behavior:

1. Periodically scan enabled `ProjectBriefingConfig` records.
2. Compare configured timezone and daily hour.
3. Generate the current day's project briefing when due.
4. If `autoSend` is true, send the generated briefing.
5. Avoid duplicate generation by relying on the unique `projectId + date + scope` constraint.

The scheduler should be conservative. If the process restarts or runs twice, dedupe and unique constraints should prevent duplicate stored briefings.

## API Surface

Suggested routes:

- `GET /briefing-sources?workspaceId=...`
- `POST /briefing-sources`
- `PATCH /briefing-sources/:id`
- `DELETE /briefing-sources/:id`
- `POST /briefing-sources/:id/gitlab-webhook`
- `GET /projects/:id/briefing-config`
- `PUT /projects/:id/briefing-config`
- `GET /projects/:id/briefings`
- `POST /projects/:id/briefings/generate`
- `GET /briefings/:id`
- `POST /briefings/:id/send`
- `GET /delivery-targets?workspaceId=...`
- `POST /delivery-targets`
- `PATCH /delivery-targets/:id`
- `DELETE /delivery-targets/:id`

DTOs should use `class-validator` and live under `apps/api/src/briefings/dto`.

## Frontend

Add FlowX Web routes under the existing protected layout:

- `/briefings`
- `/briefings/:briefingId`
- `/settings/briefing-sources`
- `/settings/delivery-targets`

Project detail page should also show a briefing configuration panel:

- enabled switch
- daily generation hour
- timezone
- auto-send switch
- link to project briefing history
- action to generate today's briefing

Briefings page:

- project filter
- date filter
- manual generate action
- history table with status, event count, generated time, sent time
- empty state when no enabled source exists

Briefing detail page:

- rendered HTML content
- Markdown source view or copy action
- included repositories/sources summary from scope
- delivery logs
- resend action

Briefing sources page:

- workspace filter
- list repositories and source status
- create/update GitLab source for a repository
- display webhook URL for copying into GitLab
- rotate or edit webhook secret

Delivery targets page:

- workspace filter
- email targets
- DingTalk robot targets
- active/inactive status
- create/update/delete actions

All frontend work should use existing FlowX UI components and patterns. No Next.js code from `daily-briefing` should be migrated directly.

## Migration Strategy

Implement in focused slices:

1. Migrate pure functions into FlowX API:
   - GitLab normalize
   - dedupe key generation
   - event aggregation
   - Markdown rendering
   - HTML rendering
   - DingTalk robot signing/sending
   - SMTP sender
2. Add Prisma models and generate client.
3. Add backend services, controllers, and DTOs.
4. Add API tests for source CRUD, webhook validation/dedupe, project generation, and delivery logs.
5. Add web API types and helpers.
6. Add frontend pages and tests.
7. Add scheduler integration.
8. Run FlowX validation commands.

`/Users/chalkley/rokid/daily-briefing` has existing uncommitted changes and should remain read-only reference material during this migration.

## Testing

API tests:

- normalize representative GitLab payloads
- build stable dedupe keys
- reject webhook requests with missing or invalid tokens
- store first webhook and mark duplicate deliveries
- generate a project briefing from workspace repository sources
- return existing briefing unless regenerate is true
- send to email and DingTalk targets with delivery logs
- record failed delivery without failing the entire send operation

Web tests:

- API client helpers for new routes
- briefing list loading and empty states
- briefing detail rendering and resend action
- briefing source form behavior
- delivery target form behavior
- project briefing config panel behavior

Validation commands:

```bash
pnpm --filter flowx-api prisma:generate
pnpm --filter flowx-api test
pnpm --filter flowx-web test
pnpm check
```

## Risks And Mitigations

- **Model coupling risk:** Keep GitLab source settings in `BriefingSource`, not `Repository`.
- **Duplicate event risk:** Use stable dedupe keys and a database unique constraint.
- **Duplicate scheduled generation risk:** Use unique briefing scope constraints.
- **Secret leakage risk:** Redact webhook secrets, DingTalk secrets, and SMTP credentials from UI errors and logs.
- **Timezone drift risk:** Store timezone in `ProjectBriefingConfig` and compute date windows explicitly.
- **UI sprawl risk:** Keep briefing pages operational and dense, matching FlowX's existing management console style.
- **Scope ambiguity risk:** Store source/repository snapshots in `Briefing.scope` at generation time.

## Out Of Scope For First Migration

- AI-generated summaries.
- GitLab API polling for historical backfill.
- GitLab OAuth or automatic webhook installation.
- Separate daily-briefing Next.js app.
- Separate daily-briefing user/session model.
- DingTalk enterprise app delivery.
- Project-specific delivery target selection.

