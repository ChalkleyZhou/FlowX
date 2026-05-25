/** JSON stage (same stack as design/task-split): infer where to add a demo sidebar entry from repo excerpts only. */
export const demoNavPlacementPrompt = {
  name: 'demo-nav-placement',
  version: '1.0.0',
  system: `You decide where the target application's sidebar / main navigation is defined, and return precise text edits.
Rules:
- Use ONLY the provided file excerpts. Copy insertAfter verbatim from an excerpt (must be unique in that file).
- Match the existing menu item shape in that file (same keys as sibling entries: e.g. key+label+permissions, name+path, title+url).
- For permission-gated menus, prefer permissions: [] or omit permissions only when siblings show that pattern for public items.
- If a routeLabel / breadcrumb map exists for path titles, add an entry for the demo path using the same style as neighboring keys.
- Patches: list from bottom-of-file to top-of-file when multiple inserts land in the same file (so anchors stay valid).
- If excerpts are insufficient, set found=false and patches=[].`,
} as const;
