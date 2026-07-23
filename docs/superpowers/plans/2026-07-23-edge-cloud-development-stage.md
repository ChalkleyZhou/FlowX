# Edge-Cloud Development Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish foundation Tasks 9–12 so Cursor/Codex local development uses Tool Adapters, a single `LocalCompletionCommand`, MCP/Extension session APIs, Web session/Evidence UI, and golden-path coverage — without `active-execution.json`.

**Architecture:** Approach C from the design spec. `launch.ts` becomes a thin redeem → AdapterRegistry → Cursor/Codex adapter path. Server extracts one local completion command; `POST /execution-sessions/:id/complete` becomes the primary entry and `complete-local` wraps it. MCP prefers session complete; Web adds a read-only session panel. Outbox remains the offline retry surface.

**Tech Stack:** NestJS + Prisma + Vitest (`apps/api`), `packages/flowx-local` / `flowx-mcp` / `flowx-protocol`, React + Vitest (`apps/web`), existing Cursor Extension.

**Spec:** `docs/superpowers/specs/2026-07-23-edge-cloud-development-stage-design.md`

---

## File map

| File | Responsibility |
| --- | --- |
| `packages/flowx-protocol/src/local-completion.ts` | `LocalCompletionReport` type + pure validators |
| `packages/flowx-protocol/src/index.ts` | Re-export local completion |
| `packages/flowx-local/src/adapters/tool-adapter.ts` | Expand capability union |
| `packages/flowx-local/src/adapters/adapter-registry.ts` | Resolve adapter by tool name |
| `packages/flowx-local/src/adapters/cursor-adapter.ts` | Cursor launch (ensure + open) |
| `packages/flowx-local/src/adapters/codex-adapter.ts` | Codex launch (ensure + open) |
| `packages/flowx-local/src/launch.ts` | Thin orchestrator only |
| `packages/flowx-local/src/open-ide.ts` | Shared open helper used by adapters |
| `apps/api/src/workflow/local-launch.service.ts` | Redeem includes `executionSessionId`; prompt includes session id |
| `apps/api/src/workflow/local-chat-prompt.ts` | Prompt lines for session id + MCP completion args |
| `apps/api/src/workflow/local-completion.command.ts` | Extracted verify → artifacts → session → workflow |
| `apps/api/src/execution-sessions/dto/complete-execution-session.dto.ts` | Accept `LocalCompletionReport` fields |
| `apps/api/src/execution-sessions/execution-sessions.service.ts` | Delegate LOCAL complete to command |
| `apps/api/src/workflow/workflow.service.ts` | `completeLocalExecution` becomes thin wrapper |
| `packages/flowx-mcp/src/flowx-api-client.ts` | Session complete / events / evidence clients |
| `packages/flowx-mcp/src/tools.ts` | progress / evidence / completion prefer session API |
| `packages/flowx-local/templates/flowx-local-execution/SKILL.md` | Instruct `executionSessionId` usage |
| `apps/cursor-extension/src/*` | Persist session id; prefer session complete |
| `apps/web/src/api.ts` | Session / events / evidence API |
| `apps/web/src/components/ExecutionSessionPanel.tsx` | Read-only session + evidence UI |
| `apps/web/src/pages/WorkflowRunDetailPage.tsx` | Mount panel on EXECUTION |
| `apps/api/src/edge/edge-golden-path.spec.ts` | Golden-path automation |
| `docs/edge-agent-operations.md` et al. | Ops / handoff docs |

---

### Task 1: Protocol — `LocalCompletionReport`

**Files:**
- Create: `packages/flowx-protocol/src/local-completion.ts`
- Modify: `packages/flowx-protocol/src/index.ts`
- Modify: `packages/flowx-protocol/src/protocol.test.ts`

- [ ] **Step 1: Write failing protocol tests**

Add to `protocol.test.ts`:

```ts
import {
  assertLocalCompletionReport,
  buildLocalCompletionIdempotencyKey,
} from './local-completion.js';

it('accepts a valid LocalCompletionReport', () => {
  const report = {
    idempotencyKey: 'local:session-1:v1',
    pushed: true,
    implementationSummary: 'Done',
    testResult: 'pass',
    repositories: [
      {
        workflowRepositoryId: 'wr-1',
        headSha: 'a'.repeat(40),
        changedFiles: ['src/a.ts'],
      },
    ],
  };
  expect(assertLocalCompletionReport(report)).toEqual(report);
});

it('rejects empty changedFiles', () => {
  expect(() =>
    assertLocalCompletionReport({
      idempotencyKey: 'k',
      pushed: false,
      repositories: [{ workflowRepositoryId: 'wr-1', headSha: 'abc', changedFiles: [] }],
    }),
  ).toThrow(/changedFiles/);
});

it('builds a stable idempotency key', () => {
  expect(
    buildLocalCompletionIdempotencyKey({
      executionSessionId: 'session-1',
      headShas: ['abc'],
    }),
  ).toBe('local:session-1:abc');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @flowx-ai/protocol test`

Expected: FAIL — module `./local-completion.js` not found

- [ ] **Step 3: Implement `local-completion.ts`**

```ts
export type LocalCompletionRepositoryReport = {
  workflowRepositoryId: string;
  headSha: string;
  changedFiles: string[];
  patchSummary?: string;
};

export type LocalCompletionReport = {
  idempotencyKey: string;
  pushed: boolean;
  implementationSummary?: string;
  testResult?: string;
  diffSummary?: string;
  untrackedFiles?: string[];
  summary?: string;
  repositories: LocalCompletionRepositoryReport[];
  metadata?: Record<string, unknown>;
};

export function buildLocalCompletionIdempotencyKey(input: {
  executionSessionId: string;
  headShas: string[];
}): string {
  const tip = input.headShas.map((s) => s.trim()).filter(Boolean).sort().join('+') || 'none';
  return `local:${input.executionSessionId}:${tip}`;
}

export function assertLocalCompletionReport(value: unknown): LocalCompletionReport {
  if (!value || typeof value !== 'object') {
    throw new Error('LocalCompletionReport must be an object');
  }
  const report = value as LocalCompletionReport;
  if (!report.idempotencyKey?.trim()) {
    throw new Error('idempotencyKey is required');
  }
  if (typeof report.pushed !== 'boolean') {
    throw new Error('pushed must be a boolean');
  }
  if (!Array.isArray(report.repositories) || report.repositories.length === 0) {
    throw new Error('repositories must be a non-empty array');
  }
  for (const repo of report.repositories) {
    if (!repo.workflowRepositoryId?.trim() || !repo.headSha?.trim()) {
      throw new Error('repository workflowRepositoryId and headSha are required');
    }
    if (!Array.isArray(repo.changedFiles) || repo.changedFiles.length === 0) {
      throw new Error('changedFiles must be a non-empty array');
    }
  }
  return report;
}
```

Export from `index.ts`: `export * from './local-completion.js';`

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @flowx-ai/protocol test`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/flowx-protocol/src/local-completion.ts packages/flowx-protocol/src/index.ts packages/flowx-protocol/src/protocol.test.ts
git commit -m "$(cat <<'EOF'
feat(protocol): add LocalCompletionReport contract

EOF
)"
```

---

### Task 2: Expand Tool Adapter capabilities + registry

**Files:**
- Modify: `packages/flowx-local/src/adapters/tool-adapter.ts`
- Create: `packages/flowx-local/src/adapters/adapter-registry.ts`
- Create: `packages/flowx-local/src/adapters/adapter-registry.test.ts`
- Modify: `packages/flowx-local/src/adapters/open-design-adapter.ts` (capabilities still valid)

- [ ] **Step 1: Write failing registry test**

```ts
import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from './adapter-registry.js';
import type { ToolAdapter } from './tool-adapter.js';

describe('AdapterRegistry', () => {
  it('resolves a registered adapter by name', () => {
    const adapter: ToolAdapter<unknown, { ok: true }> = {
      name: 'cursor',
      capabilities: ['repo-open', 'chat-handoff', 'completion-report'],
      launch: async () => ({ ok: true }),
    };
    const registry = new AdapterRegistry([adapter]);
    expect(registry.resolve('cursor')).toBe(adapter);
  });

  it('throws for unknown tools', () => {
    const registry = new AdapterRegistry([]);
    expect(() => registry.resolve('unknown')).toThrow(/unknown tool/i);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/adapters/adapter-registry.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Implement capabilities + registry**

Update `tool-adapter.ts`:

```ts
export const TOOL_ADAPTER_CAPABILITIES = [
  'repo-open',
  'chat-handoff',
  'context-import',
  'artifact-export',
  'completion-report',
] as const;

export type ToolAdapterCapability = (typeof TOOL_ADAPTER_CAPABILITIES)[number];

export interface ToolAdapter<TInput, TResult> {
  readonly name: string;
  readonly capabilities: readonly ToolAdapterCapability[];
  launch(input: TInput): Promise<TResult>;
}
```

Create `adapter-registry.ts`:

```ts
import type { ToolAdapter } from './tool-adapter.js';

export class AdapterRegistry {
  private readonly byName = new Map<string, ToolAdapter<any, any>>();

  constructor(adapters: Array<ToolAdapter<any, any>>) {
    for (const adapter of adapters) {
      this.byName.set(adapter.name, adapter);
    }
  }

  resolve(name: string): ToolAdapter<any, any> {
    const adapter = this.byName.get(name);
    if (!adapter) {
      throw new Error(`Unknown tool adapter: ${name}`);
    }
    return adapter;
  }

  list(): string[] {
    return [...this.byName.keys()];
  }
}
```

Update `OpenDesignAdapter.capabilities` to keep `context-import`, `artifact-export`, `completion-report` (already compatible).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/adapters/`

Expected: PASS (registry + existing open-design tests)

- [ ] **Step 5: Commit**

```bash
git add packages/flowx-local/src/adapters/
git commit -m "$(cat <<'EOF'
feat(local): add AdapterRegistry and IDE capabilities

EOF
)"
```

---

### Task 3: CursorAdapter + CodexAdapter

**Files:**
- Create: `packages/flowx-local/src/adapters/cursor-adapter.ts`
- Create: `packages/flowx-local/src/adapters/codex-adapter.ts`
- Create: `packages/flowx-local/src/adapters/ide-adapter.test.ts`
- Modify: `packages/flowx-local/src/open-ide.ts` (imported by adapters)

Shared launch input type (put in `cursor-adapter.ts` and re-export, or small `ide-launch.ts`):

```ts
export type IdeLaunchInput = {
  ide: 'cursor' | 'codex';
  gitRoot: string;
  workflowRunId: string;
  executionSessionId: string;
  chatPrompt: string;
  apiBaseUrl: string;
  mcpToken: string;
  mcpEntryPath: string;
};

export type IdeLaunchResult = {
  ok: true;
  gitRoot: string;
  ide: 'cursor' | 'codex';
  prefilled: boolean;
  promptPath: string;
  executionSessionId: string;
  workflowRunId: string;
};
```

- [ ] **Step 1: Write failing adapter tests**

```ts
it('CursorAdapter ensures project, writes prompt, opens cursor', async () => {
  const ensureProject = vi.fn();
  const writePromptFile = vi.fn(() => '/repo/.flowx/tasks/wf.md');
  const openIde = vi.fn(async () => ({ opened: true, prefilled: false }));
  const adapter = new CursorAdapter({ ensureProject, writePromptFile, openIde });
  const result = await adapter.launch({
    ide: 'cursor',
    gitRoot: '/repo',
    workflowRunId: 'wf-1',
    executionSessionId: 'sess-1',
    chatPrompt: 'Do work',
    apiBaseUrl: 'http://127.0.0.1:3000',
    mcpToken: 't',
    mcpEntryPath: '/mcp.js',
  });
  expect(result.executionSessionId).toBe('sess-1');
  expect(openIde).toHaveBeenCalledWith('cursor', '/repo', 'Do work');
});

it('rejects missing executionSessionId', async () => {
  const adapter = new CursorAdapter({});
  await expect(
    adapter.launch({
      ide: 'cursor',
      gitRoot: '/repo',
      workflowRunId: 'wf-1',
      executionSessionId: '',
      chatPrompt: 'x',
      apiBaseUrl: 'http://x',
      mcpToken: 't',
      mcpEntryPath: '/m.js',
    }),
  ).rejects.toThrow(/executionSessionId/);
});
```

Mirror one happy-path test for `CodexAdapter` with `ide: 'codex'`.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/adapters/ide-adapter.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement adapters**

`CursorAdapter` / `CodexAdapter`:
- `name`: `'cursor'` / `'codex'`
- `capabilities`: `['repo-open', 'chat-handoff', 'completion-report']`
- `launch`: validate ids → `ensureProject` → `writePromptFile` → `openIde(ide, ...)` → return `IdeLaunchResult`
- Do not write `~/.flowx/active-execution.json`
- Do not call completion APIs

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(local): add Cursor and Codex tool adapters

EOF
)"
```

---

### Task 4: Thin `launch.ts` + redeem must surface session id

**Files:**
- Modify: `packages/flowx-local/src/launch.ts`
- Modify: `packages/flowx-local/src/launch.test.ts`
- Modify: `apps/api/src/workflow/local-launch.service.ts`
- Modify: `apps/api/src/workflow/local-launch.service.spec.ts`
- Modify: `apps/api/src/workflow/local-chat-prompt.ts`
- Modify: `apps/api/src/workflow/local-chat-prompt.spec.ts` (create if missing)
- Modify: `packages/flowx-local/templates/flowx-local-execution/SKILL.md`

- [ ] **Step 1: API — failing redeem test for session id**

In `local-launch.service.spec.ts`, assert:

```ts
expect(redeemed.handoff.executionSessionId).toEqual(expect.any(String));
expect(redeemed.chatPrompt).toContain(redeemed.handoff.executionSessionId);
expect(redeemed.chatPrompt).toMatch(/flowx_report_completion/);
```

Ensure the mock handoff from `getLocalHandoff` includes `executionSessionId: 'session-1'` (claim path already dual-writes sessions).

- [ ] **Step 2: Update `buildLocalChatPrompt`**

Add optional `executionSessionId?: string` and `workflowRepositoryId?: string` to input. Append:

```ts
`- Execution session id: ${input.executionSessionId}`,
// in Completion section:
'Call MCP `flowx_report_completion` with workflowRunId, workflowRepositoryId, executionSessionId, implementationSummary, testResult, and pushed.',
```

Wire `LocalLaunchService.redeemTicket` to pass `handoff.executionSessionId` and first repo `workflowRepositoryId` into the prompt builder.

If handoff lacks `executionSessionId` when projection is enabled, fail redeem with a clear error (do not launch blind).

- [ ] **Step 3: Refactor `runLaunch` to use registry**

```ts
const registry = dependencies.registry ?? defaultIdeRegistry(dependencies);
const adapter = registry.resolve(request.ide);
// after redeem + resolveRepoPath:
return adapter.launch({
  ide: request.ide,
  gitRoot,
  workflowRunId: redeemed.workflowRunId,
  executionSessionId: redeemed.handoff.executionSessionId,
  chatPrompt: redeemed.chatPrompt,
  apiBaseUrl: redeemed.apiBaseUrl,
  mcpToken: redeemed.mcpToken,
  mcpEntryPath,
});
```

Update `launch.test.ts` expectations to include `executionSessionId` / `workflowRunId` on the result and mock redeem payload with `handoff.executionSessionId`.

- [ ] **Step 4: Update Skill template**

```md
# FlowX local execution

Read `.flowx/tasks/<workflow-run-id>.md` for task, branch, `workflowRunId`, `executionSessionId`, and `workflowRepositoryId`.

Implement the change, then:
1. `flowx_collect_git_report`
2. `flowx_report_completion` with those ids plus implementationSummary, testResult, and pushed
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter flowx-api exec vitest run src/workflow/local-launch.service.spec.ts src/workflow/local-chat-prompt.spec.ts
pnpm --filter @flowx-ai/local exec vitest run src/launch.test.ts src/adapters/
```

Expected: PASS

- [ ] **Step 6: Commit (end of PR A slice)**

```bash
git commit -m "$(cat <<'EOF'
refactor(local): route IDE launch through Cursor/Codex adapters

EOF
)"
```

---

### Task 5: Extract `LocalCompletionCommand` (API)

**Files:**
- Create: `apps/api/src/workflow/local-completion.command.ts`
- Create: `apps/api/src/workflow/local-completion.command.spec.ts`
- Modify: `apps/api/src/workflow/workflow.service.ts`
- Modify: `apps/api/src/workflow/workflow-local-execution.spec.ts`
- Modify: `apps/api/src/execution-sessions/dto/complete-execution-session.dto.ts`
- Modify: `apps/api/src/execution-sessions/execution-sessions.service.ts`
- Modify: `apps/api/src/execution-sessions/execution-sessions.module.ts` (wire WorkflowService or command provider)
- Modify: `apps/api/src/workflow/workflow.module.ts` if needed

**Design rule:** One implementation. Both HTTP entries call it.

- [ ] **Step 1: Write failing tests for session-complete path**

In `workflow-local-execution.spec.ts` (or new command spec):

```ts
it('completes via execution session id with the same idempotency as complete-local', async () => {
  // claim-local first, capture handoff.executionSessionId
  const claimed = await service.claimLocalExecution(runId, session);
  const sessionId = claimed.handoff.executionSessionId!;
  const body = {
    idempotencyKey: 'local:test:1',
    pushed: true,
    implementationSummary: 'done',
    testResult: 'ok',
    repositories: [/* valid repo report with real head after mock verify */],
  };
  const first = await executionSessionsService.complete(sessionId, body, scope);
  const second = await executionSessionsService.complete(sessionId, body, scope);
  expect(second.workflow.id).toBe(first.workflow.id);
  // status advanced toward review / same as complete-local
});

it('complete-local delegates to the same command', async () => {
  // spy or assert identical evidence rows / session metadata idempotencyKey
});
```

Also assert remote verify failure returns structured `{ code: 'REMOTE_BRANCH_NOT_VERIFIED' }` when practical (may wrap existing `BadRequestException` message first, then add `code` field).

- [ ] **Step 2: Run — expect FAIL** (session complete does not advance workflow yet)

- [ ] **Step 3: Expand DTO**

`CompleteExecutionSessionDto` gains the same fields as `CompleteLocalExecutionDto` (repositories, pushed, implementationSummary, …). Keep optional `summary` / `metadata` for non-local transitions.

Detection rule in `ExecutionSessionsService.complete`:

```ts
if (Array.isArray(dto.repositories) && dto.repositories.length > 0) {
  return this.workflowService.completeLocalExecutionBySession(id, dto, scope);
}
// existing thin status transition for non-local / summary-only
return this.transition(id, 'COMPLETED', dto, scope);
```

- [ ] **Step 4: Extract command**

Move the body of `completeLocalExecution` into `LocalCompletionCommand.execute({ workflowRunId, executionSessionId?, dto, notifyRecipient })`.

Add `WorkflowService.completeLocalExecutionBySession(sessionId, dto, scope)`:
1. Load session; assert `executorType === 'LOCAL'` and not terminal (unless idempotent replay)
2. Call command with `workflowRunId` from session
3. Return `{ workflow, handoff, executionSession }` shape useful to MCP

`completeLocalExecution(runId, dto)` becomes: find latest local session → `completeLocalExecutionBySession` (or command directly).

Keep design/brainstorm complete endpoints untouched.

- [ ] **Step 5: Run API local-execution + execution-session specs**

```bash
pnpm --filter flowx-api exec vitest run src/workflow/workflow-local-execution.spec.ts src/execution-sessions/
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(api): make session complete the primary local completion entry

EOF
)"
```

---

### Task 6: MCP — progress, evidence, completion prefer session API

**Files:**
- Modify: `packages/flowx-mcp/src/flowx-api-client.ts`
- Modify: `packages/flowx-mcp/src/flowx-api-client.test.ts`
- Modify: `packages/flowx-mcp/src/tools.ts`
- Modify: `packages/flowx-mcp/src/tools.test.ts`
- Modify: `packages/flowx-mcp/src/server.ts` (register new tools)

- [ ] **Step 1: Failing client tests**

```ts
it('posts LocalCompletionReport to /execution-sessions/:id/complete', async () => {
  await client.completeExecutionSession('session-1', {
    idempotencyKey: 'k',
    pushed: true,
    repositories: [{ workflowRepositoryId: 'wr-1', headSha: 'abc', changedFiles: ['a.ts'] }],
  });
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/execution-sessions/session-1/complete'),
    expect.objectContaining({ method: 'POST' }),
  );
});
```

Similar for `appendExecutionEvent` and `registerEvidence`.

- [ ] **Step 2: Implement client methods**

```ts
completeExecutionSession(executionSessionId: string, body: LocalCompletionReport & { /* CompleteLocal fields */ })
appendExecutionEvent(executionSessionId: string, body: { eventType: string; idempotencyKey: string; payload?: unknown; occurredAt?: string })
registerEvidence(executionSessionId: string, body: RegisterEvidenceInput)
```

On HTTP 404/405 for session complete when `FLOWX_REQUIRE_SESSION_COMPLETE=1` (or always for extension path): throw error including `PROTOCOL_VERSION_UNSUPPORTED`. For MCP completion tool: prefer session complete; on missing session id fall back to `completeLocal` and include `warning` in tool text result.

- [ ] **Step 3: Tools**

`flowx_report_completion` input adds optional `executionSessionId` and optional `idempotencyKey`. Logic:

1. Collect git report (unchanged empty-tree guard)
2. Build report body
3. If `executionSessionId` → `completeExecutionSession`
4. Else → `completeLocal` + warning string that session id should be passed from the prompt

Add:

```ts
flowx_report_progress({ executionSessionId, message, idempotencyKey? })
flowx_report_evidence({ executionSessionId, evidenceType, summary, idempotencyKey? })
```

Register in `server.ts` with zod schemas.

- [ ] **Step 4: Run**

```bash
pnpm --filter flowx-mcp test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(mcp): prefer ExecutionSession APIs for progress and completion

EOF
)"
```

---

### Task 7: Cursor Extension — persist session id, prefer session complete

**Files:**
- Modify: `apps/cursor-extension/src/flowx-client.ts`
- Modify: `apps/cursor-extension/src/flowx-client.test.ts`
- Modify: `apps/cursor-extension/src/completion-panel.ts`
- Modify: `apps/cursor-extension/src/completion-panel.test.ts`
- Modify: handoff/task types that store working task state

- [ ] **Step 1: Failing tests**

- `completeExecutionSession` posts to session complete route
- `reportCompletion` uses session id from task when present
- When server returns 404 for session complete **and** env/flag says protocol required → error mentions protocol unsupported (no silent `completeLocal`)
- When session id absent → may use `completeLocal` for legacy tasks (document in test name)

- [ ] **Step 2: Implement**

- Parse `executionSessionId` from handoff/claim responses into task model
- `reportCompletion` builds same body as today; prefers `client.completeExecutionSession`
- Offline: enqueue via flowx-local Outbox HTTP if available (`POST http://127.0.0.1:3920/...` only if an endpoint already exists or add minimal `completion-draft` later). **For v1 of this task:** if Outbox HTTP for completion is not ready, write a clear user error “API unavailable; retry when online” and add a follow-up checkbox in Task 10 docs — do **not** invent a third draft format. Prefer extending existing Outbox in a small follow-up commit inside this task if `/outbox` or sync path can accept completion payloads already used by design-submit.

Check `packages/flowx-local/src/outbox.ts` — if design-submit pattern can be reused for `execution.completion_requested`, add a thin enqueue helper; otherwise document deferral in ops doc (Task 12) without blocking Extension online path.

- [ ] **Step 3: Run**

```bash
pnpm --filter flowx-cursor-extension test
```

(Use the actual package name from `apps/cursor-extension/package.json` if different.)

- [ ] **Step 4: Commit (end of PR B slice)**

```bash
git commit -m "$(cat <<'EOF'
feat(cursor): report local completion via ExecutionSession API

EOF
)"
```

---

### Task 8: Web API client for sessions and evidence

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts` (or create)
- Modify: `apps/web/src/types.ts`

- [ ] **Step 1: Failing API tests**

```ts
it('gets execution session by id', async () => {
  await api.getExecutionSession('session-1');
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/execution-sessions/session-1'),
    expect.any(Object),
  );
});

it('lists session evidence', async () => {
  await api.listExecutionSessionEvidence('session-1');
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/execution-sessions/session-1/evidence'),
    expect.any(Object),
  );
});

it('lists session events', async () => {
  await api.listExecutionSessionEvents('session-1');
});
```

- [ ] **Step 2: Implement methods + types** matching API responses (`status`, `sourceTool`, `traceId`, `lastHeartbeatAt`, evidence rows).

- [ ] **Step 3: Run**

```bash
pnpm --filter flowx-web exec vitest run src/api.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): add execution session and evidence API client

EOF
)"
```

---

### Task 9: `ExecutionSessionPanel` + wire WorkflowRunDetailPage

**Files:**
- Create: `apps/web/src/components/ExecutionSessionPanel.tsx`
- Create: `apps/web/src/components/ExecutionSessionPanel.test.tsx`
- Create: `apps/web/src/components/EvidenceList.tsx` (optional split if panel grows)
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`
- Read: `apps/web/AGENTS.md` before editing

- [ ] **Step 1: Component tests**

- Renders status, tool, traceId when session prop present
- Renders evidence items
- Renders nothing / null when `executionSessionId` missing (parent hides)
- Refresh button calls `onRefresh`

Keep UI consistent with existing shadcn/`Card` patterns on the detail page — no new visual system.

- [ ] **Step 2: Implement panel**

Props:

```ts
type Props = {
  session: ExecutionSessionDetail | null;
  evidence: EvidenceItem[];
  events?: SyncEventItem[];
  loading?: boolean;
  onRefresh?: () => void;
};
```

- [ ] **Step 3: Wire page**

When `localHandoff?.executionSessionId` is set and EXECUTION selected:
- Load session + evidence (and optionally events)
- Refresh on ≤30s interval while tab visible / stage selected, or only on manual refresh + after complete-local success
- Keep existing local launch / complete-local dialogs

- [ ] **Step 4: Run**

```bash
pnpm --filter flowx-web exec vitest run src/components/ExecutionSessionPanel.test.tsx src/pages/WorkflowRunDetailPage.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): show execution session and evidence on workflow detail

EOF
)"
```

---

### Task 10: Golden-path tests + docs + foundation checklist

**Files:**
- Create: `apps/api/src/edge/edge-golden-path.spec.ts`
- Modify: `docs/edge-agent-operations.md`
- Modify: `docs/web-local-ide-launch.md`
- Modify: `docs/local-execution-handoff.md`
- Modify: `docs/superpowers/plans/2026-07-22-edge-cloud-foundation.md` (check off Task 9–12 items that this plan completes)
- Modify: `docs/superpowers/specs/2026-07-23-edge-cloud-development-stage-design.md` status → Approved/Implemented as appropriate

- [ ] **Step 1: Golden-path API tests** (mock git remote / use existing test harness patterns from `workflow-local-execution.spec.ts`)

Cover at least:

1. claim → session complete → workflow leaves EXECUTION_RUNNING toward review
2. idempotent replay of same `idempotencyKey`
3. `pushed: false` with remote URL → rejected
4. cancel-local then complete → rejected
5. `complete-local` still succeeds (compat)

Outbox/offline cases that need `flowx-local` can live in `packages/flowx-local/src/outbox.test.ts` extensions:
- enqueue completion-shaped item → sync posts once → second sync no-ops

- [ ] **Step 2: Docs**

State explicitly:
- No `active-execution.json` for development
- Completion keyed by `executionSessionId`
- `complete-local` is a compatibility wrapper
- MCP tools: progress / evidence / completion
- Rollout order from the design spec §8.2

- [ ] **Step 3: Run full check**

```bash
pnpm check
```

Expected: PASS

- [ ] **Step 4: Commit (end of PR C)**

```bash
git commit -m "$(cat <<'EOF'
test(edge): cover development-stage golden path and update docs

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec section | Plan task |
| --- | --- |
| §5 Adapter SPI / launch | Tasks 2–4 |
| §6 LocalCompletionCommand + MCP/Extension | Tasks 1, 5–7 |
| §7 Web panel | Tasks 8–9 |
| §8 Golden path + docs | Task 10 |
| No active-execution.json | Tasks 3–4, 10 |
| Correction valve `.flowx/task.json` | Out of scope (not scheduled) |
| PR A/B/C split | Tasks 2–4 / 5–7 / 8–10 |

**Placeholder scan:** No TBD/TODO left in steps. Extension offline Outbox is explicitly bounded (reuse or defer with docs) to avoid a third draft store.

**Type consistency:** `LocalCompletionReport` from Task 1 is the body for session complete, MCP, and Extension.

---

## Execution notes

- High-risk: `workflow.service.ts`, `execution-sessions`, `apps/web/src/api.ts` — tests before implementation on those tasks.
- Do not commit unrelated web design-system dirty files sitting in the worktree.
- Prefer feature flags already used for session projection (`FLOWX_EXECUTION_SESSION_WRITE_ENABLED` etc.) rather than inventing new ones unless a client default needs a kill switch.
