# Demo Generation Progress Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure demo generation prioritizes eventual result while continuously reporting progress to users.

**Architecture:** Keep the existing ideation status model but add a structured progress-event stream bound to demo sessions. The backend emits stage and heartbeat events across the execution pipeline (context scan, model run, parse, write, preview). The frontend renders these events as a live progress timeline and failure diagnostics. Timeout policy changes from short fixed cutoff to no-progress-based failure with a larger wall cap.

**Tech Stack:** NestJS, Prisma, TypeScript, React, Vitest.

---

### Task 1: Add demo progress event schema and persistence

**Files:**
- Create: `apps/api/prisma/migrations/20260423170000_add_ideation_session_events/migration.sql`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/requirements/ideation-session-events.repository.ts`
- Test: `apps/api/src/requirements/ideation-session-events.repository.spec.ts`

- [ ] **Step 1: Write failing repository test for event append/query**

```ts
it('appends and lists events in created order', async () => {
  await repo.append({
    sessionId: 's1',
    eventType: 'STARTED',
    stage: 'QUEUE',
    message: 'Demo generation started',
  });
  await repo.append({
    sessionId: 's1',
    eventType: 'STAGE',
    stage: 'MODEL_RUNNING',
    message: 'Calling AI model',
  });

  const events = await repo.list('s1');
  expect(events.map((e) => e.stage)).toEqual(['QUEUE', 'MODEL_RUNNING']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/api test -- --runInBand src/requirements/ideation-session-events.repository.spec.ts`  
Expected: FAIL because repository/table does not exist.

- [ ] **Step 3: Add Prisma model and migration**

```prisma
model IdeationSessionEvent {
  id         String   @id @default(cuid())
  sessionId  String
  eventType  String
  stage      String
  message    String
  details    Json?
  createdAt  DateTime @default(now())

  session IdeationSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, createdAt])
}
```

- [ ] **Step 4: Implement repository append/list methods**

```ts
async append(input: AppendEventInput) {
  return this.prisma.ideationSessionEvent.create({
    data: {
      sessionId: input.sessionId,
      eventType: input.eventType,
      stage: input.stage,
      message: input.message,
      details: input.details ?? undefined,
    },
  });
}
```

- [ ] **Step 5: Re-run repository test**

Run: `pnpm -C apps/api test -- --runInBand src/requirements/ideation-session-events.repository.spec.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/requirements/ideation-session-events.repository.ts apps/api/src/requirements/ideation-session-events.repository.spec.ts
git commit -m "feat: add ideation session progress event storage"
```

### Task 2: Emit structured progress events in demo generation pipeline

**Files:**
- Modify: `apps/api/src/requirements/requirements.service.ts`
- Modify: `apps/api/src/requirements/requirements.module.ts`
- Test: `apps/api/src/requirements/requirements-demo.spec.ts`

- [ ] **Step 1: Add failing demo flow test for event sequence**

```ts
it('emits demo progress stages in order', async () => {
  await service.startDemoGeneration(requirement.id, 'make dashboard demo');
  const events = await eventsRepo.listByRequirement(requirement.id);
  expect(events.some((e) => e.stage === 'CONTEXT_SCAN')).toBe(true);
  expect(events.some((e) => e.stage === 'MODEL_RUNNING')).toBe(true);
  expect(events.some((e) => e.stage === 'WRITE_FILES')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/api test -- --runInBand src/requirements/requirements-demo.spec.ts`  
Expected: FAIL due to missing event emissions.

- [ ] **Step 3: Emit events around each demo step**

```ts
await this.eventsRepo.append({
  sessionId: session.id,
  eventType: 'STAGE',
  stage: 'CONTEXT_SCAN',
  message: 'Scanning repository components',
});
```

```ts
await this.eventsRepo.append({
  sessionId: session.id,
  eventType: 'STAGE',
  stage: 'WRITE_FILES',
  message: `Writing ${result.demoPages.length} demo pages`,
  details: { count: result.demoPages.length },
});
```

- [ ] **Step 4: Update `statusMessage` projection from latest event**

```ts
const statusMessage = `${event.message} (${elapsedSeconds}s)`;
await this.prisma.ideationSession.update({
  where: { id: session.id },
  data: { statusMessage },
});
```

- [ ] **Step 5: Re-run demo tests**

Run: `pnpm -C apps/api test -- --runInBand src/requirements/requirements-demo.spec.ts`  
Expected: PASS (existing known unrelated failures outside this file are acceptable).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/requirements/requirements.service.ts apps/api/src/requirements/requirements.module.ts apps/api/src/requirements/requirements-demo.spec.ts
git commit -m "feat: emit stage-based demo progress events"
```

### Task 3: Update cursor executor timeout strategy for result-first behavior

**Files:**
- Modify: `apps/api/src/ai/cursor-ai.executor.ts`
- Test: `apps/api/src/ai/cursor-ai.executor.spec.ts`

- [ ] **Step 1: Add failing test for no-progress timeout semantics**

```ts
it('does not fail active-output demo runs before wall timeout', async () => {
  // mock process emits chunks every 20s for 6 minutes
  // expect no no-progress failure
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/api test -- --runInBand src/ai/cursor-ai.executor.spec.ts`  
Expected: FAIL with previous timeout behavior.

- [ ] **Step 3: Implement dual-timeout policy**

```ts
const noProgressTimeoutMs = readMsEnv('CURSOR_NO_PROGRESS_TIMEOUT_MS', 120_000);
const wallTimeoutMs = readMsEnv('CURSOR_DEMO_WALL_TIMEOUT_MS', 1_200_000);

// fail on no progress
// allow long-running job while progress continues
```

- [ ] **Step 4: Emit throttled executor progress callback hooks**

```ts
onProgress?.({
  eventType: 'STDOUT',
  stage: 'MODEL_RUNNING',
  message: 'Model streaming output',
  details: { stdoutBytes, stderrBytes },
});
```

- [ ] **Step 5: Re-run executor tests**

Run: `pnpm -C apps/api test -- --runInBand src/ai/cursor-ai.executor.spec.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai/cursor-ai.executor.ts apps/api/src/ai/cursor-ai.executor.spec.ts
git commit -m "fix: switch demo timeout to progress-aware policy"
```

### Task 4: Expose progress API and render live progress timeline in web panel

**Files:**
- Modify: `apps/api/src/requirements/requirements.controller.ts`
- Modify: `apps/api/src/requirements/dto/ideation.dto.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/components/IdeationDesignPanel.tsx`
- Test: `apps/web/src/components/IdeationDesignPanel.test.tsx`

- [ ] **Step 1: Add failing frontend test for live stage rendering**

```tsx
it('renders demo progress stage and elapsed time while running', async () => {
  render(<IdeationDesignPanel ... />);
  expect(await screen.findByText(/MODEL_RUNNING/i)).toBeInTheDocument();
  expect(screen.getByText(/已等待/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Add backend endpoint to fetch session events**

```ts
@Get(':id/ideation/sessions/:sessionId/events')
getIdeationSessionEvents(@Param('sessionId') sessionId: string) {
  return this.requirementsService.getIdeationSessionEvents(sessionId);
}
```

- [ ] **Step 3: Wire API client + polling**

```ts
export async function getIdeationSessionEvents(
  requirementId: string,
  sessionId: string,
): Promise<IdeationSessionEvent[]> {
  return request(`/requirements/${requirementId}/ideation/sessions/${sessionId}/events`);
}
```

- [ ] **Step 4: Render timeline + concise status banner**

```tsx
{events.slice(-5).map((e) => (
  <li key={e.id}>{e.stage} - {e.message}</li>
))}
```

- [ ] **Step 5: Re-run web tests**

Run: `pnpm -C apps/web test -- IdeationDesignPanel.test.tsx`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/requirements/requirements.controller.ts apps/api/src/requirements/dto/ideation.dto.ts apps/web/src/api.ts apps/web/src/types.ts apps/web/src/components/IdeationDesignPanel.tsx apps/web/src/components/IdeationDesignPanel.test.tsx
git commit -m "feat: show live demo generation progress timeline"
```

### Task 5: Recovery and verification

**Files:**
- Modify: `apps/api/src/requirements/ideation-recovery.service.ts`
- Test: `apps/api/src/requirements/ideation-recovery.service.spec.ts`
- Modify: `docs/docker-deployment.md`

- [ ] **Step 1: Add failing recovery test for stale running demo with old heartbeat**

```ts
it('marks stale demo run as failed when no heartbeat exceeds threshold', async () => {
  // arrange running session with old event timestamp
  // expect status transitions to FAILED with reason
});
```

- [ ] **Step 2: Implement recovery rule using latest event timestamp**

```ts
if (session.status === 'RUNNING' && latestEventAgeMs > staleThresholdMs) {
  // mark failed with stage-aware message
}
```

- [ ] **Step 3: Run targeted API tests**

Run:
- `pnpm -C apps/api test -- --runInBand src/requirements/requirements-demo.spec.ts`
- `pnpm -C apps/api test -- --runInBand src/requirements/ideation-recovery.service.spec.ts`

Expected: PASS for touched files.

- [ ] **Step 4: Run frontend targeted tests**

Run: `pnpm -C apps/web test -- IdeationDesignPanel.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Document operations and env vars**

Document:
- `CURSOR_NO_PROGRESS_TIMEOUT_MS`
- `CURSOR_DEMO_WALL_TIMEOUT_MS`
- `FLOWX_DEMO_PROGRESS_EVENTS`
- troubleshooting by stage/event.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/requirements/ideation-recovery.service.ts apps/api/src/requirements/ideation-recovery.service.spec.ts docs/docker-deployment.md
git commit -m "chore: harden demo recovery and document progress operations"
```

---

## Verification Checklist

- [ ] Trigger demo generation and confirm first event appears within 3 seconds.
- [ ] Confirm event stream updates at least every 10 seconds during model run.
- [ ] Confirm successful run reaches `WRITE_FILES` and preview start stages.
- [ ] Confirm failure run shows explicit failed stage and actionable reason.
- [ ] Confirm restart recovery reconciles stale running sessions using heartbeat age.
