# Demo Generation Feedback-First Design

## Goal

Make Demo generation "waitable with continuous feedback" instead of "silent until timeout".

Acceptance targets:

1. First visible progress within 3 seconds after trigger.
2. Progress refresh at least every 10 seconds while running.
3. On failure, return explicit failed stage + reason (no silent failure).
4. Prefer completion over early timeout for active-progress jobs.

## Architecture

Use a feedback-first job flow without changing the existing ideation stage model:

- Keep `DEMO_PENDING -> DEMO_WAITING_CONFIRMATION` flow.
- Add structured progress events per demo session.
- Let long-running executions continue when progress exists.
- Fail only on hard conditions (auth error, invalid output, process crash, no progress over threshold).

## Progress Event Model

Add normalized event records (persisted and queryable):

- `sessionId`
- `eventType`: `STARTED | STAGE | HEARTBEAT | STDERR | STDOUT | RETRY | FAILED | COMPLETED`
- `stage`: `QUEUE | CONTEXT_SCAN | MODEL_RUNNING | JSON_PARSE | WRITE_FILES | PREVIEW_START`
- `message`: short user-facing text
- `details`: optional structured payload (bytes, elapsed, retryCount)
- `createdAt`

Status message in `ideationSession` becomes a projection of latest event, not ad-hoc text.

## Backend Changes

### Requirements Service

- Start Demo generation as session job and write `STARTED` event immediately.
- Emit stage events around repository scan, AI call, parse, file write, and preview start.
- On retries, emit `RETRY` with reason and attempt index.
- On failure, emit `FAILED` with stage and reason; keep requirement at `DESIGN_CONFIRMED`.

### Cursor Executor

- Stream stdout/stderr into progress events (throttled).
- Treat "has ongoing output/progress" as healthy, even if long-running.
- Replace fixed short cutoff with:
  - `no-progress timeout` (hard fail when no progress at all)
  - `max wall timeout` (large safety cap)
- Preserve current debug artifact writing.

### Retry Policy

- Retry AI call 1-2 times only for transient classes:
  - JSON parse failure with non-empty output
  - temporary process exit / transport error
- Do not retry auth/config errors.

## Frontend Changes

In `IdeationDesignPanel`:

- Render progress timeline/cards for latest demo session.
- Show stage + elapsed + last update time.
- Keep button disabled while running.
- Show retry count and latest log snippet.
- On failure, show actionable reason with one-click retry.

## Observability

- API logs must include `requirementId`, `sessionId`, `stage`, `attempt`, elapsed ms.
- Progress API endpoint should support incremental polling by timestamp/id.
- Keep existing cursor debug artifacts as deep diagnostics.

## Testing

### Backend

- Unit test event emission order for successful run.
- Unit test no-progress timeout failure path.
- Unit test retry path and non-retryable auth failure path.

### Frontend

- Component test: running state shows stage + elapsed + progress refresh.
- Component test: failure state shows stage-specific reason and retry entry.

## Risks and Mitigations

- Event volume too high: throttle stdout/stderr ingestion and store summarized lines.
- Stale running sessions after restart: extend recovery service to reconcile by latest event heartbeat.
- UI noise: collapse logs by default, keep concise stage banner visible.

## Rollout

1. Ship behind env flag `FLOWX_DEMO_PROGRESS_EVENTS=true`.
2. Verify on a few real requirements first.
3. Remove old "silent polling only" behavior after confidence.
