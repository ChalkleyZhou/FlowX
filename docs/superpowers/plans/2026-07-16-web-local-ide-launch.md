# Web Local IDE Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From FlowX Web, one click claims local execution, talks to a loopback `flowx-local` bridge, opens Cursor or Codex on the matched repo with Skill/MCP/prompt ready.

**Architecture:** Reuse `claim-local` / `local-handoff` / `complete-local`. Add short-lived launch tickets on the API. New `packages/flowx-local` daemon owns path mapping, Skill/MCP ensure, IDE open, and prompt delivery. Web probes daemon health then POSTs `/launch`.

**Tech Stack:** NestJS, Vitest, Node HTTP (loopback), React/Vite web, existing `flowx-mcp`, `buildLocalChatPrompt` / handoff builders.

**Design spec:** `docs/superpowers/specs/2026-07-16-web-local-ide-launch-design.md`

---

## File map

| Path | Role |
|------|------|
| `apps/api/src/workflow/local-launch-ticket.store.ts` | In-memory single-use ticket store |
| `apps/api/src/workflow/local-launch.service.ts` | Issue + redeem tickets; build chatPrompt; mint short MCP session |
| `apps/api/src/workflow/local-launch.service.spec.ts` | Ticket tests |
| `apps/api/src/workflow/workflow.controller.ts` | `POST :id/execution/local-launch-ticket` |
| `apps/api/src/workflow/local-launch.controller.ts` | `POST /local-launch/redeem` (no session guard; ticket auth) |
| `apps/api/src/auth/auth.service.ts` | Public helper to mint short-lived `UserSession` for MCP |
| `packages/flowx-local/*` | CLI + loopback daemon |
| `packages/flowx-local/templates/flowx-local-execution/SKILL.md` | Thin Skill template |
| `apps/web/src/api.ts` | Ticket + local probe/launch helpers |
| `apps/web/src/lib/flowx-local-bridge.ts` | Loopback URL, health, launch |
| `apps/web/src/pages/WorkflowRunDetailPage.tsx` | **本地启动** UX |
| `docs/web-local-ide-launch.md` | User-facing setup notes |

---

### Task 1: Launch ticket store + issue/redeem service

**Files:**
- Create: `apps/api/src/workflow/local-launch-ticket.store.ts`
- Create: `apps/api/src/workflow/local-launch.service.ts`
- Create: `apps/api/src/workflow/local-launch.service.spec.ts`
- Modify: `apps/api/src/auth/auth.service.ts` (add `createShortLivedSession`)
- Modify: `apps/api/src/workflow/workflow.module.ts`

- [ ] **Step 1: Write failing tests**

```ts
// local-launch.service.spec.ts
describe('LocalLaunchService', () => {
  it('issues a ticket and redeems once with handoff + mcpToken + chatPrompt', async () => {
    // mock workflowService.getLocalHandoff / claim as needed
    // mock authService.createShortLivedSession → { token: 'mcp-1', expiresAt }
    const issued = await service.issueTicket('run-1', session);
    expect(issued.ticket).toMatch(/^[a-f0-9]{64}$/);
    const redeemed = await service.redeemTicket(issued.ticket);
    expect(redeemed.workflowRunId).toBe('run-1');
    expect(redeemed.mcpToken).toBe('mcp-1');
    expect(redeemed.chatPrompt).toContain('run-1');
    await expect(service.redeemTicket(issued.ticket)).rejects.toThrow(/invalid|expired/i);
  });

  it('rejects expired tickets', async () => {
    // issue with ttlMs: 1, wait, redeem fails
  });
});
```

- [ ] **Step 2: Implement store**

```ts
// local-launch-ticket.store.ts
export type LocalLaunchTicketRecord = {
  ticket: string;
  workflowRunId: string;
  userId: string;
  organizationId: string | null;
  expiresAt: number;
  consumedAt?: number;
};

export class LocalLaunchTicketStore {
  private readonly tickets = new Map<string, LocalLaunchTicketRecord>();
  create(record: Omit<LocalLaunchTicketRecord, 'ticket'> & { ticket?: string }): LocalLaunchTicketRecord { /* random 32 bytes hex */ }
  consume(ticket: string): LocalLaunchTicketRecord { /* throw if missing/expired/consumed */ }
}
```

- [ ] **Step 3: Implement `AuthService.createShortLivedSession(userId, organizationId, ttlMs)`**

Create `UserSession` with `expiresAt = now + ttlMs` (default 2h). Return `{ token, expiresAt }`. Keep existing `createSession` private path intact by extracting shared private insert helper if needed.

- [ ] **Step 4: Implement `LocalLaunchService`**

- `issueTicket(workflowRunId, session)` — verify user can access run (same guards as claim/get handoff); ensure handoff readable (run must be EXECUTION_RUNNING with local executor OR allow issue only after claim — caller claims first); store ticket TTL 5 minutes; return `{ ticket, expiresAt, loopbackPort: 3920 }`.
- `redeemTicket(ticket)` — consume; `getLocalHandoff`; build `chatPrompt` via `buildLocalChatPrompt` from requirement + first repo (taskType requirement, taskId = requirementId); `createShortLivedSession`; return `{ apiBaseUrl, workflowRunId, handoff, chatPrompt, mcpToken, mcpTokenExpiresAt }`.

Use `process.env.PUBLIC_API_BASE_URL` or request host fallback for `apiBaseUrl` — for v1 return `http://127.0.0.1:${PORT||3000}`.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter flowx-api test -- src/workflow/local-launch.service.spec.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/local-launch-ticket.store.ts apps/api/src/workflow/local-launch.service.ts apps/api/src/workflow/local-launch.service.spec.ts apps/api/src/auth/auth.service.ts apps/api/src/workflow/workflow.module.ts
git commit -m "feat(api): add local launch ticket issue and redeem"
```

---

### Task 2: HTTP endpoints for ticket + redeem

**Files:**
- Modify: `apps/api/src/workflow/workflow.controller.ts`
- Create: `apps/api/src/workflow/local-launch.controller.ts`
- Modify: `apps/api/src/workflow/workflow.module.ts`
- Create: `apps/api/src/workflow/local-launch.controller.spec.ts` (optional thin) or extend service specs only
- Modify: `apps/api/src/app.module.ts` if controller registration needs it (usually via WorkflowModule)

- [ ] **Step 1: Add authenticated route**

```ts
@Post(':id/execution/local-launch-ticket')
issueLocalLaunchTicket(@Param('id') id: string, @Req() req: WorkflowRequest) {
  return this.localLaunchService.issueTicket(id, req.authSession);
}
```

- [ ] **Step 2: Add public redeem route**

```ts
@Controller('local-launch')
export class LocalLaunchController {
  @Post('redeem')
  redeem(@Body() body: { ticket: string }) {
    return this.localLaunchService.redeemTicket(body.ticket);
  }
}
```

Ensure `SessionAuthGuard` does **not** block `/local-launch/redeem`. Check how public routes are excluded (auth guard global) and mirror existing public patterns (e.g. health/oauth).

- [ ] **Step 3: Manual/API test via unit covering controller wiring if guard is tricky**

```bash
pnpm --filter flowx-api test -- src/workflow/local-launch
pnpm --filter flowx-api build
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(api): expose local-launch ticket and redeem HTTP routes"
```

---

### Task 3: `flowx-local` package skeleton + config + health

**Files:**
- Create: `packages/flowx-local/package.json` (`name: flowx-local`, bin `flowx-local`, type module)
- Create: `packages/flowx-local/tsconfig.json`
- Create: `packages/flowx-local/src/config.ts`
- Create: `packages/flowx-local/src/config.test.ts`
- Create: `packages/flowx-local/src/index.ts` (CLI entry)
- Create: `packages/flowx-local/src/server.ts`

Default port `3920`. Config file `~/.flowx/local.json`:

```json
{
  "port": 3920,
  "repositories": {
    "https://github.com/org/repo.git": "/Users/me/src/repo"
  },
  "defaultIde": "cursor"
}
```

- [ ] **Step 1: Failing tests for load/save config + normalize repo URL keys**

Normalize: trim, lowercase host, strip `.git` suffix, ignore credentials in URL.

- [ ] **Step 2: Implement config + `GET /health` → `{ ok: true, version }`**

- [ ] **Step 3: CLI `flowx-local` / `flowx-local serve` starts server on 127.0.0.1 only**

- [ ] **Step 4: Build + test**

```bash
pnpm --filter flowx-local build
pnpm --filter flowx-local test
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(flowx-local): add loopback daemon skeleton and config"
```

---

### Task 4: Repo mapping + path picker + launch orchestration

**Files:**
- Create: `packages/flowx-local/src/repo-map.ts`
- Create: `packages/flowx-local/src/repo-map.test.ts`
- Create: `packages/flowx-local/src/ensure-project.ts`
- Create: `packages/flowx-local/src/ensure-project.test.ts`
- Create: `packages/flowx-local/src/open-ide.ts`
- Create: `packages/flowx-local/src/open-ide.test.ts`
- Create: `packages/flowx-local/src/launch.ts`
- Create: `packages/flowx-local/src/launch.test.ts`
- Create: `packages/flowx-local/templates/flowx-local-execution/SKILL.md`
- Modify: `packages/flowx-local/src/server.ts` — `POST /launch`

- [ ] **Step 1: Tests for resolvePath**

- mapped → path  
- unmapped + `selectDirectory()` returns path → save map  
- unmapped + cancel → throw `PATH_CANCELLED`

Inject `selectDirectory` for tests (no real native dialog in CI). For runtime v1 on macOS, use `osascript` folder chooser; Linux/Windows: throw clear error asking `flowx-local map <url> <path>`.

- [ ] **Step 2: `ensureProject(gitRoot, { apiBaseUrl, mcpToken, mcpPackageEntry })`**

Write if missing:

- `.cursor/skills/flowx-local-execution/SKILL.md` from template  
- `.cursor/mcp.json` merging `flowx` server:

```json
{
  "mcpServers": {
    "flowx": {
      "command": "node",
      "args": ["<absolute-path-to-flowx-mcp/dist/index.js>"],
      "env": {
        "FLOWX_API_BASE_URL": "<apiBaseUrl>",
        "FLOWX_API_TOKEN": "<mcpToken>"
      }
    }
  }
}
```

Resolve mcp entry via `require.resolve` / `import.meta` relative to monorepo or `FLOWX_MCP_ENTRY` env. Also write `.agents/skills/flowx-local-execution/SKILL.md` copy for Codex-oriented layouts when `.agents` exists or always write both (v1: write both).

- [ ] **Step 3: Write prompt file `.flowx/tasks/<workflowRunId>.md`**

- [ ] **Step 4: `openIde(ide, path, prompt)`**

Order: try deep link / CLI; return `{ opened: boolean, prefilled: boolean }`. Clipboard copy via `pbcopy`/`xclip`/PowerShell best-effort.

Cursor CLI: `cursor <path>`. Codex: `codex` with cwd or documented CLI; if unknown, open path with `open` on macOS and rely on prompt file.

- [ ] **Step 5: `POST /launch` body**

```ts
{
  ticket: string;
  ide: 'cursor' | 'codex';
  apiBaseUrl?: string; // optional override; else from redeem
}
```

Flow: redeem ticket → for each handoff repo resolve path (v1: first repo only is enough for acceptance; still accept array) → ensure → write prompt → open IDE → response `{ ok: true, gitRoot, ide, prefilled, promptPath }`.

- [ ] **Step 6: Test + commit**

```bash
pnpm --filter flowx-local test
git commit -m "feat(flowx-local): launch orchestration with skill/mcp ensure"
```

---

### Task 5: Web bridge helpers + API client

**Files:**
- Create: `apps/web/src/lib/flowx-local-bridge.ts`
- Create: `apps/web/src/lib/flowx-local-bridge.test.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/types.ts` if needed

- [ ] **Step 1: Bridge helpers**

```ts
export const FLOWX_LOCAL_DEFAULT_PORT = 3920;
export function flowxLocalBaseUrl(port = FLOWX_LOCAL_DEFAULT_PORT) {
  return `http://127.0.0.1:${port}`;
}
export async function probeFlowxLocal(port?: number): Promise<boolean> { /* GET /health */ }
export async function launchFlowxLocal(body: {
  ticket: string;
  ide: 'cursor' | 'codex';
}, port?: number): Promise<{ ok: true; gitRoot: string; prefilled: boolean; promptPath: string }> { /* POST /launch */ }
```

- [ ] **Step 2: `api.issueLocalLaunchTicket(id)`**

```ts
issueLocalLaunchTicket: (id: string) =>
  request<{ ticket: string; expiresAt: string; loopbackPort: number }>(
    `/workflow-runs/${id}/execution/local-launch-ticket`,
    { method: 'POST' },
  ),
```

- [ ] **Step 3: Tests for URL builders / error mapping**

```bash
pnpm --filter flowx-web test -- src/lib/flowx-local-bridge.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): add flowx-local bridge client helpers"
```

---

### Task 6: Workflow detail「本地启动」UX

**Files:**
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`
- Create or modify: related test if page tests exist for execution actions

- [ ] **Step 1: Replace prominent「本地执行」claim-only primary with「本地启动」**

Behavior:

1. If status `EXECUTION_PENDING` → `claimLocalExecution`  
2. If already local running → skip claim  
3. `issueLocalLaunchTicket`  
4. `probeFlowxLocal(ticket.loopbackPort)` — if false, show setup callout with `pnpm --filter flowx-local exec flowx-local serve` (or `npx` path) and stop  
5. Ask IDE: Cursor vs Codex (simple `window.prompt` is unacceptable — use existing dropdown/Dialog/Button group patterns on the page)  
6. `launchFlowxLocal({ ticket, ide })`  
7. Toast success including prefilled vs clipboard fallback  

Keep **完成本地执行** / **取消本地执行**. Keep **云端执行**.

- [ ] **Step 2: Manual smoke notes in code comment or docs only — add page test for action wiring if feasible**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): wire 本地启动 to flowx-local bridge"
```

---

### Task 7: Docs + root script convenience

**Files:**
- Create: `docs/web-local-ide-launch.md`
- Modify: `docs/local-execution-handoff.md` (link to new doc)
- Modify: root `package.json` — script `"flowx-local": "pnpm --filter flowx-local exec node dist/index.js"`

- [ ] **Step 1: Write setup doc** (install, serve, map, Web button, MCP report)

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: explain web local IDE launch setup"
```

---

### Task 8: Vertical verification

- [ ] **Step 1: Run**

```bash
pnpm --filter flowx-api test -- src/workflow/local-launch
pnpm --filter flowx-local test
pnpm --filter flowx-web test -- src/lib/flowx-local-bridge.test.ts
pnpm --filter flowx-api build
pnpm --filter flowx-local build
pnpm --filter flowx-web build
```

- [ ] **Step 2: Manual checklist** (document results in PR/handoff)

1. `pnpm --filter flowx-local exec node dist/index.js serve`  
2. Workflow `EXECUTION_PENDING` → 本地启动 → Cursor  
3. Repo opens; prompt file exists  
4. MCP token present in `.cursor/mcp.json` env  

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| Web-first 本地启动 + IDE choice | 6 |
| flowx-local loopback | 3–4 |
| Repo map + picker remember | 4 |
| Skill + MCP ensure | 4 |
| Prompt file + Chat best-effort | 4 |
| claim-local / complete-local parity | 1, 6 (reuse) |
| Launch ticket | 1–2 |
| Daemon missing UX | 6 |
| Thin v1 / no auto-clone | Non-goals respected |
| Docs | 7 |

## Deferred (not in this plan)

- `flowx://` custom protocol installer  
- Perfect Codex Chat prefill  
- Multi-repo parallel open  
- Removing Cursor extension  
