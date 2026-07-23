# FlowX Local npm Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `@flowx-ai/protocol` and `@flowx-ai/local` to public npm, update install docs/Web copy, and add a GitHub Actions publish workflow so users can `npm i -g @flowx-ai/local && flowx-local serve`.

**Architecture:** In-place rename of monorepo packages (no mirror packages). `apps/api` and `@flowx-ai/local` import `@flowx-ai/protocol`. Local keeps CLI bin name `flowx-local`. CI builds, tests, then publishes protocol then local on `workflow_dispatch` or `flowx-ai-v*` tags.

**Tech Stack:** pnpm workspaces, TypeScript NodeNext packages, GitHub Actions, public npm scoped packages (`@flowx-ai/*`).

**Spec:** `docs/superpowers/specs/2026-07-23-flowx-local-npm-publish-design.md`

---

## File map

| File | Responsibility |
| --- | --- |
| `packages/flowx-protocol/package.json` | Publishable `@flowx-ai/protocol` metadata |
| `packages/flowx-local/package.json` | Publishable `@flowx-ai/local` metadata + `files` including `templates` |
| `packages/flowx-local/src/{config,edge-client,adapters/open-design-adapter}.ts` | Import `@flowx-ai/protocol` |
| `apps/api/package.json` + API `src/**` imports | Depend on / import `@flowx-ai/protocol` |
| `package.json` (root) | Filters and `flowx-local` script |
| `apps/web/src/pages/WorkflowRunDetailPage.tsx` | End-user install/start copy |
| `apps/web/src/pages/WorkflowRunDetailPage.test.tsx` | Assert npm install instructions |
| `docs/edge-agent-operations.md`, `docs/opendesign-design-stage.md`, `docs/user-manual.md`, `docs/web-local-ide-launch.md`, `README.md` | User vs contributor install paths |
| `.github/workflows/publish-npm.yml` | Build/test/publish both packages |

Directory paths under `packages/flowx-*` stay as-is; only package `name` fields change.

---

### Task 1: Make `@flowx-ai/protocol` publishable

**Files:**
- Modify: `packages/flowx-protocol/package.json`
- Modify: `apps/api/package.json`
- Modify: all API/local imports of `flowx-protocol` (listed in steps)

- [ ] **Step 1: Rewrite protocol package.json**

Replace `packages/flowx-protocol/package.json` with:

```json
{
  "name": "@flowx-ai/protocol",
  "version": "0.1.0",
  "description": "Shared protocol types and constants for FlowX edge agents",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist"
  ],
  "engines": {
    "node": ">=20"
  },
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "prepublishOnly": "pnpm run build"
  },
  "devDependencies": {
    "typescript": "^5.8.2",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Point API dependency at the new name**

In `apps/api/package.json`, change:

```json
"flowx-protocol": "workspace:*"
```

to:

```json
"@flowx-ai/protocol": "workspace:^"
```

- [ ] **Step 3: Update all TypeScript imports from `flowx-protocol` to `@flowx-ai/protocol`**

Replace import specifier `'flowx-protocol'` → `'@flowx-ai/protocol'` in:

- `apps/api/src/execution-sessions/execution-session-state.ts`
- `apps/api/src/execution-sessions/sync-events.service.ts`
- `apps/api/src/execution-sessions/dto/append-sync-event.dto.ts`
- `apps/api/src/execution-sessions/execution-sessions.service.ts`
- `apps/api/src/artifacts/dto/register-artifact.dto.ts`
- `apps/api/src/artifacts/dto/register-evidence.dto.ts`
- `apps/api/src/artifacts/artifacts.service.ts`
- `apps/api/src/artifacts/artifacts.controller.ts`
- `apps/api/src/edge/edge.controller.ts`
- `apps/api/src/edge/open-design-edge.service.ts`
- `apps/api/src/edge/context-package.service.ts`
- `apps/api/src/workflow/workflow.service.ts`
- `packages/flowx-local/src/config.ts`
- `packages/flowx-local/src/edge-client.ts`
- `packages/flowx-local/src/adapters/open-design-adapter.ts`

Use a repo-wide replace for the import string only (do not rename CLI product name `flowx-local` in prose).

- [ ] **Step 4: Reinstall and verify protocol build/tests**

Run:

```bash
pnpm install
pnpm --filter @flowx-ai/protocol build
pnpm --filter @flowx-ai/protocol test
pnpm --filter flowx-api build
```

Expected: install rewrites lockfile; all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/flowx-protocol/package.json apps/api/package.json \
  apps/api/src packages/flowx-local/src pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
refactor: publish protocol as @flowx-ai/protocol

EOF
)"
```

---

### Task 2: Make `@flowx-ai/local` publishable

**Files:**
- Modify: `packages/flowx-local/package.json`
- Modify: `package.json` (repo root)

- [ ] **Step 1: Rewrite local package.json**

Replace `packages/flowx-local/package.json` with:

```json
{
  "name": "@flowx-ai/local",
  "version": "0.1.0",
  "description": "FlowX Edge Agent — local loopback daemon and CLI",
  "type": "module",
  "bin": {
    "flowx-local": "./dist/index.js"
  },
  "files": [
    "dist",
    "templates"
  ],
  "engines": {
    "node": ">=20"
  },
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "prepublishOnly": "pnpm run build"
  },
  "dependencies": {
    "@flowx-ai/protocol": "workspace:^"
  },
  "devDependencies": {
    "@types/node": "^22.13.10",
    "typescript": "^5.8.2",
    "vitest": "^3.2.4"
  }
}
```

Critical: `templates` must be in `files` so Skill ensure works after `npm install -g`.

- [ ] **Step 2: Update root scripts to filter the new package name**

In root `package.json`:

1. Change script:

```json
"flowx-local": "pnpm --filter @flowx-ai/local exec node dist/index.js"
```

2. Change `build` (and `build:api` if it filters protocol) from `flowx-protocol` to `@flowx-ai/protocol`. Current values:

```json
"build": "pnpm -r --filter flowx-protocol --filter flowx-api --filter flowx-web build",
"build:api": "pnpm -r --filter flowx-protocol --filter flowx-api build",
```

Become:

```json
"build": "pnpm -r --filter @flowx-ai/protocol --filter flowx-api --filter flowx-web build",
"build:api": "pnpm -r --filter @flowx-ai/protocol --filter flowx-api build",
```

- [ ] **Step 3: Reinstall and verify local package**

Run:

```bash
pnpm install
pnpm --filter @flowx-ai/local build
pnpm --filter @flowx-ai/local test
pnpm flowx-local status
```

Expected: build/tests pass; `status` prints JSON with `deviceId` / `protocolVersion` (may create `~/.flowx/local.json` if missing).

- [ ] **Step 4: Commit**

```bash
git add packages/flowx-local/package.json package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
refactor: publish local agent as @flowx-ai/local

EOF
)"
```

---

### Task 3: Web install / start copy + test

**Files:**
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`
- Read first: `apps/web/AGENTS.md`

- [ ] **Step 1: Write failing test for npm install instructions**

In `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`, add a focused case near other local-launch tests (after mocks are set up so the local handoff / setup callout can render). Pattern:

```tsx
it('shows npm install instructions when flowx-local is missing', async () => {
  // Arrange using the same helpers as nearby local-launch / handoff tests so
  // 「本地执行指引」 or the missing-daemon callout is visible.

  expect(
    await screen.findByText(/npm install -g @flowx-ai\/local/, { exact: false }),
  ).toBeTruthy();
  expect(screen.getByText(/flowx-local serve/, { exact: false })).toBeTruthy();
  expect(screen.queryByText(/pnpm --filter flowx-local/, { exact: false })).toBeNull();
});
```

If the page only shows the monorepo command inside static list items (not gated on health), assert those list items instead — the npm strings above are the contract.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter flowx-web exec vitest run src/pages/WorkflowRunDetailPage.test.tsx -t "npm install"
```

Expected: FAIL — old `pnpm --filter flowx-local` copy still present / new strings missing.

- [ ] **Step 3: Update WorkflowRunDetailPage copy**

In `apps/web/src/pages/WorkflowRunDetailPage.tsx`:

1. Replace the ordered-list step that currently contains
   `pnpm --filter flowx-local exec node dist/index.js serve` with:

```tsx
<li>
  若未启动 flowx-local，先安装并启动：
  <code className="text-foreground">npm install -g @flowx-ai/local</code>
  ，然后运行
  <code className="text-foreground">flowx-local serve</code>
</li>
```

2. Replace the missing-daemon callout body with:

```tsx
<div className="mt-1 text-muted-foreground">
  请先安装并启动本机 Agent：
  <div className="mt-1">
    <code className="text-foreground">npm install -g @flowx-ai/local</code>
  </div>
  <div className="mt-1">
    <code className="text-foreground">flowx-local serve</code>
  </div>
</div>
```

Do not change toast short messages that only say “未检测到本机 flowx-local…” (product name stays `flowx-local`).

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter flowx-web exec vitest run src/pages/WorkflowRunDetailPage.test.tsx -t "npm install"
pnpm --filter flowx-web test
```

Expected: targeted test PASS; full web suite PASS (or only pre-existing failures unrelated to this change).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/WorkflowRunDetailPage.tsx apps/web/src/pages/WorkflowRunDetailPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): point local agent setup at @flowx-ai/local npm install

EOF
)"
```

---

### Task 4: User-facing docs

**Files:**
- Modify: `docs/edge-agent-operations.md`
- Modify: `docs/opendesign-design-stage.md`
- Modify: `docs/user-manual.md`
- Modify: `docs/web-local-ide-launch.md`
- Modify: `README.md`

- [ ] **Step 1: Update edge-agent-operations.md start section**

Replace the “常用命令 / 在仓库内运行” block so end users come first:

```markdown
## 常用命令

终端用户（推荐）：

```bash
npm install -g @flowx-ai/local
flowx-local serve
flowx-local status
flowx-local sync
flowx-local design-submit <executionSessionId>
```

也可不安装全局：`npx @flowx-ai/local serve`。

贡献者在 monorepo 内开发时：

```bash
pnpm --filter @flowx-ai/local build
pnpm flowx-local serve
pnpm flowx-local status
pnpm flowx-local sync
pnpm flowx-local design-submit <executionSessionId>
```
```

Keep directories / troubleshooting sections; only fix remaining old filter start commands.

- [ ] **Step 2: Update opendesign-design-stage.md “启动 flowx-local”**

Put npm install + `flowx-local serve` first; add a short “开发者” subsection with
`pnpm --filter @flowx-ai/local` / `pnpm flowx-local`.

- [ ] **Step 3: Update web-local-ide-launch.md**

- End users: `npm install -g @flowx-ai/local` then `flowx-local serve`
- Contributors: `pnpm --filter @flowx-ai/local build` and `pnpm flowx-local serve`
- Map examples: `flowx-local map ...` / `pnpm flowx-local map ...`

- [ ] **Step 4: Update user-manual.md §4.2**

```markdown
1. 先安装并启动本机 Agent：`npm install -g @flowx-ai/local`，然后运行 `flowx-local serve`。
```

- [ ] **Step 5: Update README OpenDesign / local agent section**

Replace the monorepo-only start block with:

```bash
npm install -g @flowx-ai/local
flowx-local serve
```

Add one contributor line: monorepo 内可用 `pnpm --filter @flowx-ai/local build && pnpm flowx-local serve`。

Leave architectural mentions of the product name `flowx-local` as-is.

- [ ] **Step 6: Commit**

```bash
git add docs/edge-agent-operations.md docs/opendesign-design-stage.md \
  docs/user-manual.md docs/web-local-ide-launch.md README.md
git commit -m "$(cat <<'EOF'
docs: document npm install for @flowx-ai/local

EOF
)"
```

---

### Task 5: GitHub Actions publish workflow

**Files:**
- Create: `.github/workflows/publish-npm.yml`

- [ ] **Step 1: Add publish workflow**

Create `.github/workflows/publish-npm.yml`:

```yaml
name: Publish @flowx-ai packages

on:
  workflow_dispatch:
  push:
    tags:
      - 'flowx-ai-v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.12.1

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Build protocol
        run: pnpm --filter @flowx-ai/protocol build

      - name: Build local
        run: pnpm --filter @flowx-ai/local build

      - name: Test protocol
        run: pnpm --filter @flowx-ai/protocol test

      - name: Test local
        run: pnpm --filter @flowx-ai/local test

      - name: Publish protocol
        working-directory: packages/flowx-protocol
        run: pnpm publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Publish local
        working-directory: packages/flowx-local
        run: pnpm publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Notes:

- Align pnpm action with root `packageManager` (`pnpm@10.12.1`).
- Repo secret `NPM_TOKEN` is required for a real publish.
- Dry-run locally: `pnpm publish --dry-run` in each package dir after build.

- [ ] **Step 2: Dry-run publish locally**

```bash
pnpm --filter @flowx-ai/protocol build
pnpm --filter @flowx-ai/local build
pnpm --filter @flowx-ai/protocol exec pnpm publish --dry-run --access public --no-git-checks
pnpm --filter @flowx-ai/local exec pnpm publish --dry-run --access public --no-git-checks
```

Expected: dry-run lists tarball contents; local includes `templates/`; protocol includes `dist/`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish-npm.yml
git commit -m "$(cat <<'EOF'
ci: add npm publish workflow for @flowx-ai packages

EOF
)"
```

---

### Task 6: Pack smoke test (install from tarball)

**Files:**
- None required (verification only).

- [ ] **Step 1: Pack both packages**

```bash
pnpm --filter @flowx-ai/protocol build
pnpm --filter @flowx-ai/local build
mkdir -p /tmp/flowx-ai-pack && rm -rf /tmp/flowx-ai-pack/*
cd packages/flowx-protocol && pnpm pack --pack-destination /tmp/flowx-ai-pack
cd ../flowx-local && pnpm pack --pack-destination /tmp/flowx-ai-pack
ls -la /tmp/flowx-ai-pack
```

Expected: two `.tgz` files (names like `flowx-ai-protocol-0.1.0.tgz` / `flowx-ai-local-0.1.0.tgz`).

- [ ] **Step 2: Confirm templates are inside the local tarball**

```bash
tar -tzf /tmp/flowx-ai-pack/flowx-ai-local-0.1.0.tgz | grep 'templates/flowx-local-execution/SKILL.md'
```

Adjust the tarball filename if `pnpm pack` uses a different name. Expected: one matching path under `package/templates/...`.

- [ ] **Step 3: Install local tarball in a clean prefix and run CLI**

```bash
rm -rf /tmp/flowx-ai-prefix
mkdir -p /tmp/flowx-ai-prefix
npm install -g --prefix /tmp/flowx-ai-prefix \
  /tmp/flowx-ai-pack/flowx-ai-protocol-0.1.0.tgz \
  /tmp/flowx-ai-pack/flowx-ai-local-0.1.0.tgz
/tmp/flowx-ai-prefix/bin/flowx-local status
```

Expected: exits 0; prints JSON status. If needed, install protocol then local sequentially into the same prefix.

- [ ] **Step 4: Fix packaging bugs if found**

If `templates` missing or bin broken, fix `files` / `bin` and commit:

```bash
git commit -m "$(cat <<'EOF'
fix: include templates in @flowx-ai/local package files

EOF
)"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run focused package + web checks**

```bash
pnpm --filter @flowx-ai/protocol build
pnpm --filter @flowx-ai/local build
pnpm --filter @flowx-ai/protocol test
pnpm --filter @flowx-ai/local test
pnpm --filter flowx-api build
pnpm --filter flowx-web test
```

Expected: all exit 0.

- [ ] **Step 2: Grep for stale package names in install instructions**

```bash
rg 'pnpm --filter flowx-local|"flowx-protocol"|from '\''flowx-protocol'\''' -g '!docs/superpowers/**' -g '!**/node_modules/**'
```

Expected: no remaining code/docs install paths using old filter/import except historical specs under `docs/superpowers/`. Product-name mentions of CLI `flowx-local` are fine.

- [ ] **Step 3: Hand off publish prerequisites to humans**

PR body checklist (no secrets in git):

1. Create npm org `@flowx-ai` if missing.
2. Add repo secret `NPM_TOKEN` with publish rights.
3. First release: versions `0.1.0`, then Actions `workflow_dispatch` or tag `flowx-ai-v0.1.0`.

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Rename to `@flowx-ai/protocol` / `@flowx-ai/local` | 1, 2 |
| Remove private; public publishConfig; engines; files+templates | 1, 2 |
| workspace dep + published caret via `workspace:^` | 1, 2 |
| CLI bin remains `flowx-local` | 2 |
| Root script still works | 2 |
| Web + docs npm install path | 3, 4 |
| Publish CI on dispatch + `flowx-ai-v*` | 5 |
| npm pack / install smoke | 6 |
| Monorepo build/test verification | 7 |
| MCP out of scope | — (not scheduled) |
