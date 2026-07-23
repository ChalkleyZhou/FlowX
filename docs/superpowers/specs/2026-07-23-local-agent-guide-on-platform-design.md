# Local Agent Guide on Platform Design

**Date:** 2026-07-23  
**Status:** Approved for planning  
**Scope:** Add an end-user Local Agent usage guide as a first-class page in FlowX Web, with sidebar navigation and a cross-link from the existing user manual. Do not deep-link from workflow missing-daemon callouts in this change.

## Goal

Platform users can open **本地 Agent** in the app, read how to install and run `@flowx-ai/local`, and use it with Web「本地启动」/ OpenDesign — without leaving FlowX or cloning the monorepo.

## Decisions

| Topic | Choice |
| --- | --- |
| Placement | Independent page (not only a section inside the general manual) |
| Audience | End users (install → serve → Web usage → short FAQ) |
| Approach | Same pattern as `UserManualPage`: markdown in `public/`, rendered in-app |
| Nav | Secondary nav item next to「使用手册」 |
| Cross-link | General user manual gets a short section linking to `/local-agent` |
| Out of scope | Workflow banner deep-link, full ops doc migration, docs hub, npm README rewrite |

## Content

**Source of truth:** `docs/local-agent-guide.md`  
**Served copy:** `apps/web/public/local-agent-guide.md`  
Keep both in sync manually (same convention as `user-manual.md`). No build-time copy script in this change.

### Outline

1. What it is — local Edge Agent bridging FlowX Web ↔ IDE / OpenDesign  
2. Install — `npm install -g @flowx-ai/local` (note public registry if needed)  
3. Start — `flowx-local serve` and `npx @flowx-ai/local serve`  
4. Use in FlowX — workflow「本地启动」, OpenDesign entry  
5. Common commands — brief `status`, `sync`, `map`  
6. FAQ — daemon not detected, Outbox stuck (short answers only)

Tone: Chinese, copy-paste friendly commands, no monorepo contributor deep-dive (point to repo docs if needed in one line).

## Platform surface

| Piece | Detail |
| --- | --- |
| Route | `/local-agent` |
| Nav | `secondaryItems`: `{ key: '/local-agent', label: '本地 Agent' }` in `AppLayout.tsx` |
| Page | New page (e.g. `LocalAgentGuidePage`) using shared markdown doc renderer |
| Shared UI | Extract lightweight `MarkdownDocPage` (props: `url`, `eyebrow`, `title`, `description`) so `UserManualPage` and the new page do not duplicate ReactMarkdown wiring |
| Manual cross-link | Update `docs/user-manual.md` and `apps/web/public/user-manual.md` with a short「本机 Agent」section linking to `/local-agent` |

Markdown in-app links to `/local-agent` should open in the same app (prefer `target` same-tab for internal paths when rendering, or document that users click the nav; if the shared renderer always uses `target="_blank"`, use a clear in-manual note that the sidebar「本地 Agent」opens the guide — prefer fixing the shared renderer so paths starting with `/` navigate in-app without `target="_blank"`).

## Testing

- Layout/nav test: secondary menu includes「本地 Agent」and route key `/local-agent`  
- Optional page test: mock-fetch of markdown renders title or a known heading  
- Update existing `UserManualPage` only as needed after extracting shared component (smoke that `/user-manual` still loads)

## Non-goals

- Publishing ops content from `docs/edge-agent-operations.md` wholesale into the platform  
- Docs index / multi-doc hub  
- Linking from WorkflowRunDetail missing-daemon callout (deferred)  
- Automated sync script from `docs/` → `public/`  
- Changing Edge Agent runtime behavior

## Risks

- Forgetting to update both `docs/` and `public/` copies causes stale UI content  
- Internal markdown links with `target="_blank"` feel broken; shared renderer should treat absolute app paths carefully
