import { access, readFile, readdir, writeFile } from 'fs/promises';
import { join, relative } from 'path';

const NAV_AGENT_MAX_FILES = 32;
const NAV_AGENT_LINE_CAP = 120;
import type { DemoPage } from './types';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.turbo',
  'storybook-static',
]);

/** Align with demo-router-integration normalizeDemoRoutePath */
function normalizeDemoRoutePath(route: string): string {
  return route.trim().replace(/^\/+/, '');
}

export function inferMonorepoSrcRoots(repoRoot: string, appPackagePrefix: string): string[] {
  const roots = new Set<string>();
  roots.add(join(repoRoot, 'src'));
  const pref = appPackagePrefix.replace(/\\/g, '/').replace(/\/$/, '');
  if (pref) {
    roots.add(join(repoRoot, pref, 'src'));
  }
  return Array.from(roots);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectTsxUnder(dir: string, out: string[], maxFiles: number, depth: number, maxDepth: number): Promise<void> {
  if (depth > maxDepth || out.length >= maxFiles) {
    return;
  }
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= maxFiles) {
      return;
    }
    if (SKIP_DIRS.has(ent.name)) {
      continue;
    }
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      await collectTsxUnder(abs, out, maxFiles, depth + 1, maxDepth);
    } else if (ent.name.endsWith('.tsx') || (ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts'))) {
      out.push(abs);
    }
  }
}

const MENU_ARRAY_OPEN_RE =
  /\b(navMain|sidebarNav|navigationItems|menuItems|navItems|sidebarItems)\s*:\s*\[|\b(navMain|sidebarNav|navigationItems|menuItems|navItems|sidebarItems)\b\s*[^=]*?=\s*\[|\bitems\s*:\s*\w+\[\]\s*=\s*\[/;

function looksLikeNavMenuSource(text: string, fileName: string): boolean {
  if (MENU_ARRAY_OPEN_RE.test(text)) {
    return true;
  }
  const n = fileName.toLowerCase();
  return (
    /(sidebar|sidenav|app-nav|main-nav|navigation)/i.test(n) &&
    /(SidebarMenu|sideNav|menuItems|navItems)/i.test(text)
  );
}

/** Label + path for one top-level nav item (hub navLabel / mockData.navLabel, else "FlowX Demo"). */
export function resolveDemoNavMenuSpec(demoPages: DemoPage[]): { label: string; hrefPath: string } | null {
  if (demoPages.length === 0) {
    return null;
  }
  const segmentLists = demoPages.map((p) => normalizeDemoRoutePath(p.route).split('/').filter(Boolean));
  const firstSeg = segmentLists.find((s) => s.length > 0)?.[0];
  if (!firstSeg) {
    return null;
  }
  const hrefPath = `/${firstSeg}`;

  const hubIndex = segmentLists.findIndex((s) => s.length === 1);
  const hub = hubIndex >= 0 ? demoPages[hubIndex] : undefined;
  const fromMock =
    hub && typeof hub.mockData?.navLabel === 'string' ? hub.mockData.navLabel.trim() : '';
  const label = (hub?.navLabel?.trim() || fromMock || 'FlowX Demo') as string;
  return { label, hrefPath };
}

/**
 * Best-effort: append one item to a data-driven menu array (navMain, menuItems, const items: T[] = [, …).
 * Probes the first array element to match existing shape: key+label (antd sidebar configs), name+path, or title+url.
 */
export function tryPatchNavMenuDataSource(
  text: string,
  spec: { label: string; hrefPath: string },
): { content: string; changed: boolean } {
  const m = text.match(MENU_ARRAY_OPEN_RE);
  if (!m || m.index === undefined) {
    return { content: text, changed: false };
  }
  const insertAt = m.index + m[0].length;
  const probe = text.slice(insertAt, insertAt + 500);
  const useKeyLabel =
    /\bkey\s*:\s*['"]/.test(probe) &&
    /\blabel\s*:\s*['"]/.test(probe) &&
    !(/\bname\s*:\s*['"]/.test(probe) && /\bpath\s*:\s*['"]/.test(probe));
  const useNamePath =
    /\bname\s*:\s*['"]/.test(probe) &&
    /\bpath\s*:\s*['"]/.test(probe) &&
    !/\btitle\s*:\s*['"]/.test(probe);
  let line: string;
  if (useKeyLabel) {
    /** permissions: [] → visible without permission codes (common layout pattern). */
    line = `\n    { key: ${JSON.stringify(spec.hrefPath)}, label: ${JSON.stringify(spec.label)}, permissions: [] },`;
  } else if (useNamePath) {
    line = `\n    { name: ${JSON.stringify(spec.label)}, path: ${JSON.stringify(spec.hrefPath)} },`;
  } else {
    line = `\n    { title: ${JSON.stringify(spec.label)}, url: ${JSON.stringify(spec.hrefPath)} },`;
  }
  return { content: text.slice(0, insertAt) + line + text.slice(insertAt), changed: true };
}

/** Breadcrumb / header label map, e.g. const routeLabel = { '/': '首页', ... } */
export function tryPatchRouteLabelMap(
  text: string,
  spec: { label: string; hrefPath: string },
): { content: string; changed: boolean } {
  const esc = spec.hrefPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`['"]${esc}['"]\\s*:`).test(text)) {
    return { content: text, changed: false };
  }
  const keyStr = JSON.stringify(spec.hrefPath);
  const m = text.match(/\brouteLabel\s*=\s*\{/);
  if (!m || m.index === undefined) {
    return { content: text, changed: false };
  }
  const insertAt = m.index + m[0].length;
  const line = `\n  ${keyStr}: ${JSON.stringify(spec.label)},`;
  return { content: text.slice(0, insertAt) + line + text.slice(insertAt), changed: true };
}

function applyLayoutMenuAndRouteLabelPatches(
  text: string,
  spec: { label: string; hrefPath: string },
): { content: string; changed: boolean } {
  const nav = tryPatchNavMenuDataSource(text, spec);
  if (!nav.changed) {
    return nav;
  }
  let content = nav.content;
  const rl = tryPatchRouteLabelMap(content, spec);
  if (rl.changed) {
    content = rl.content;
  }
  return { content, changed: true };
}

export async function integrateDemoMainNavigation(
  repoRoot: string,
  appPackagePrefix: string,
  demoPages: DemoPage[],
): Promise<{
  attempted: boolean;
  patchedRelativePath?: string;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const spec = resolveDemoNavMenuSpec(demoPages);
  if (!spec) {
    return { attempted: false, warnings: ['FlowX demo nav: could not infer route prefix for menu link.'] };
  }

  const roots = inferMonorepoSrcRoots(repoRoot, appPackagePrefix);
  const candidates: string[] = [];
  for (const root of roots) {
    if (!(await pathExists(root))) {
      continue;
    }
    await collectTsxUnder(root, candidates, 400, 0, 16);
  }

  const unique = Array.from(new Set(candidates));
  const scored = unique
    .map((abs) => {
      const rel = relative(repoRoot, abs).replace(/\\/g, '/');
      const base = rel.split('/').pop() ?? '';
      let score = 0;
      if (/sidebar|navigation|nav|menu/i.test(base)) {
        score += 8;
      }
      if (/layout|shell|app-/i.test(rel)) {
        score += 3;
      }
      return { abs, rel, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);

  const tryFiles: { abs: string; rel: string }[] = [];
  for (const s of scored) {
    let text: string;
    try {
      text = await readFile(s.abs, 'utf8');
    } catch {
      continue;
    }
    if (looksLikeNavMenuSource(text, s.rel)) {
      tryFiles.push({ abs: s.abs, rel: s.rel });
    }
  }

  if (tryFiles.length === 0) {
    for (const s of scored.slice(0, 35)) {
      let text: string;
      try {
        text = await readFile(s.abs, 'utf8');
      } catch {
        continue;
      }
      if (MENU_ARRAY_OPEN_RE.test(text)) {
        tryFiles.push({ abs: s.abs, rel: s.rel });
      }
    }
  }

  let navPatchedRel: string | undefined;
  for (const f of tryFiles.slice(0, 12)) {
    const text = await readFile(f.abs, 'utf8');
    const patched = applyLayoutMenuAndRouteLabelPatches(text, spec);
    if (patched.changed) {
      await writeFile(f.abs, patched.content, 'utf8');
      navPatchedRel = f.rel;
      break;
    }
  }

  if (navPatchedRel) {
    return {
      attempted: true,
      patchedRelativePath: navPatchedRel,
      warnings: [`FlowX demo nav: appended "${spec.label}" → ${spec.hrefPath} in ${navPatchedRel}.`],
    };
  }

  warnings.push(
    `FlowX demo nav: no patchable menu array (menuItems, items: T[] = [, …) — add a link to ${spec.hrefPath} in the app shell if needed.`,
  );
  return { attempted: true, warnings };
}

/** Long-form excerpts for Codex: ranked layout/sidebar candidates + optional router file first. */
export async function collectNavAgentSourceExcerpts(
  repoRoot: string,
  appPackagePrefix: string,
  routerRelativePath?: string,
): Promise<Array<{ relativePath: string; excerpt: string }>> {
  const roots = inferMonorepoSrcRoots(repoRoot, appPackagePrefix);
  const candidates: string[] = [];
  for (const root of roots) {
    if (!(await pathExists(root))) {
      continue;
    }
    await collectTsxUnder(root, candidates, 400, 0, 16);
  }

  const unique = Array.from(new Set(candidates));
  const scored = unique
    .map((abs) => {
      const rel = relative(repoRoot, abs).replace(/\\/g, '/');
      const base = rel.split('/').pop() ?? '';
      let score = 0;
      if (/sidebar|navigation|nav|menu/i.test(base)) {
        score += 8;
      }
      if (/layout|shell|app-/i.test(rel)) {
        score += 3;
      }
      return { abs, rel, score };
    })
    .sort((a, b) => b.score - a.score);

  const out: Array<{ relativePath: string; excerpt: string }> = [];

  const pushExcerpt = async (rel: string, abs: string) => {
    let text: string;
    try {
      text = await readFile(abs, 'utf8');
    } catch {
      return;
    }
    const lines = text.split('\n');
    let excerpt = lines.slice(0, NAV_AGENT_LINE_CAP).join('\n');
    if (excerpt.length > 48_000) {
      excerpt = excerpt.slice(0, 48_000) + '\n/* … truncated … */\n';
    }
    out.push({ relativePath: rel, excerpt });
  };

  if (routerRelativePath) {
    const rel = routerRelativePath.replace(/\\/g, '/');
    const abs = join(repoRoot, rel);
    if (await pathExists(abs)) {
      await pushExcerpt(rel, abs);
    }
  }

  for (const s of scored) {
    if (out.length >= NAV_AGENT_MAX_FILES) {
      break;
    }
    const rel = s.rel.replace(/\\/g, '/');
    if (routerRelativePath && rel === routerRelativePath.replace(/\\/g, '/')) {
      continue;
    }
    if (out.some((o) => o.relativePath === rel)) {
      continue;
    }
    await pushExcerpt(rel, s.abs);
  }

  return out;
}
