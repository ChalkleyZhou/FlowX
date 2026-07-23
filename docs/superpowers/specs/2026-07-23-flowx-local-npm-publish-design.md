# FlowX Local npm Publish Design

**Date:** 2026-07-23  
**Status:** Approved for planning  
**Scope:** Publish `@flowx-ai/protocol` and `@flowx-ai/local` to the public npm registry; update install docs and Web copy; add GitHub Actions publish workflow. `flowx-mcp` stays private for a later change.

## Goal

End users install and run the Edge Agent without cloning the FlowX monorepo:

```bash
npm install -g @flowx-ai/local
flowx-local serve
```

`npx @flowx-ai/local serve` is also supported.

## Decisions

| Topic | Choice |
| --- | --- |
| Registry | Public npm |
| Package names | `@flowx-ai/protocol`, `@flowx-ai/local` |
| Protocol packaging | Separate published package; local depends on it |
| Approach | In-place rename in monorepo + tag/manual publish (no Changesets yet) |
| Deliverables | Packages + docs/Web install copy + publish CI |
| Out of scope | `@flowx-ai/mcp`, auto-install from browser, Changesets |

## Package surface

### Rename in place

| Path | Current name | Published name |
| --- | --- | --- |
| `packages/flowx-protocol` | `flowx-protocol` | `@flowx-ai/protocol` |
| `packages/flowx-local` | `flowx-local` | `@flowx-ai/local` |

- CLI bin for local remains `flowx-local` (command name unchanged).
- Remove `private: true`.
- Set `publishConfig.access` to `"public"`.
- Set `engines.node` to `">=20"`.
- `files` for protocol: `dist` (and any required package metadata already implied).
- `files` for local: `dist` and `templates` (Skill templates must ship with the package).

### Dependencies

- Monorepo: `@flowx-ai/local` depends on `@flowx-ai/protocol` via `workspace:*`.
- Published tarball: dependency resolves to the registry version with a caret range (e.g. `^0.1.0`).
- Both packages share the same semver for this phase (start at `0.1.0`). Bump both `package.json` versions together before a release. Changesets are deferred.

### Unchanged runtime behavior

Port (`3920`), `~/.flowx` layout, loopback-only HTTP, ticket redeem, outbox, and OpenDesign adapter behavior stay the same. This change is distribution-only.

## User and contributor install paths

### End users (primary)

```bash
npm install -g @flowx-ai/local
flowx-local serve
flowx-local status
flowx-local sync
```

### Contributors (monorepo)

```bash
pnpm --filter @flowx-ai/local build
pnpm flowx-local serve
```

Root `package.json` script `flowx-local` continues to proxy to the local package `dist` entry.

## Docs and Web copy

Replace monorepo-only start instructions with npm install + `flowx-local serve` in:

- `apps/web` local-launch / missing-daemon callouts (including copyable command strings)
- `docs/edge-agent-operations.md`
- `docs/opendesign-design-stage.md`
- `docs/user-manual.md`
- README sections that tell users how to start `flowx-local`

Keep a short “development from monorepo” note where contributor docs need it. Do not change loopback health probe behavior.

## Publish CI

Add `.github/workflows/publish-npm.yml`:

- **Triggers:** `workflow_dispatch` and push of tags matching `flowx-ai-v*` (e.g. `flowx-ai-v0.1.0`).
- **Steps:** checkout → setup Node 20 + pnpm → install → build protocol then local → test both → `npm publish` protocol then local with `--access public --no-git-checks`.
- **Auth:** `NPM_TOKEN` repository secret.
- **Not in scope:** publish on every `main` commit; npm provenance can be a follow-up.

### Pre-publish checklist (human)

1. npm org `@flowx-ai` exists and the token can publish under it.
2. Package names are available (or already owned by the org).
3. Versions in both `package.json` files match the intended tag.

## Verification

- `pnpm --filter @flowx-ai/protocol --filter @flowx-ai/local build` and tests pass in the monorepo.
- `npm pack` both packages; install the local tarball in a clean environment; `flowx-local` CLI starts.
- Confirm packed tarball includes `templates/` for local.
- Web tests covering install/setup copy are updated if present.
- Publish workflow supports dry-run / `npm publish --dry-run` validation of order and auth wiring.

## Risks

- First publish fails if the npm org or package names are not ready.
- Renames touch filters, root scripts, docs, and imports; must be updated consistently.
- Omitting `templates` from `files` breaks Skill ensure-on-launch.

## Non-goals

- Publishing `flowx-mcp` / `@flowx-ai/mcp`
- Browser-driven installer
- Changing Edge Agent protocol or API contracts
- Changesets / automated changelog in this change
