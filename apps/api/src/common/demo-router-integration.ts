import { access, readFile, readdir, writeFile } from 'fs/promises';
import { dirname, join, relative } from 'path';
import { integrateDemoMainNavigation } from './demo-nav-integration';
import type { DemoPage } from './types';

/** Trie for URL segments → nested RouteObject tree (React Router 6–friendly). */
interface RouteTrieNode {
  segment: string;
  page?: DemoPage;
  children: Map<string, RouteTrieNode>;
}

export interface DemoRouterIntegrationResult {
  ok: boolean;
  routerRelativePath?: string;
  generatedRelativePath?: string;
  /** Route paths relative to the SPA (no leading slash), for logs / UI */
  normalizedRoutes: string[];
  warnings: string[];
  /** Best-effort patch to a data-driven sidebar/menu source (navMain / menuItems / …). */
  navMenuPatch?: {
    attempted: boolean;
    patchedRelativePath?: string;
  };
}

/** Codex-driven fallback when heuristics miss: reads excerpts and returns insertAfter patches. */
export type NavPlacementAgent = (input: {
  repoRoot: string;
  appPackagePrefix: string;
  demoPages: DemoPage[];
  routerRelativePath?: string;
}) => Promise<{ patchedRelativePath?: string; warnings: string[] } | null | undefined>;

export type IntegrateFlowxDemoRoutesOptions = {
  navPlacementAgent?: NavPlacementAgent;
};

const GENERATED_MODULE_BASENAME = 'flowx-demo-routes.generated';

async function mergeNavIntegration(
  repoRoot: string,
  appPackagePrefix: string,
  demoPages: DemoPage[],
  warnings: string[],
  routerRelativePath: string | undefined,
  navPlacementAgent?: NavPlacementAgent,
): Promise<DemoRouterIntegrationResult['navMenuPatch']> {
  if (demoPages.length === 0) {
    return undefined;
  }
  const nav = await integrateDemoMainNavigation(repoRoot, appPackagePrefix, demoPages);
  warnings.push(...nav.warnings);
  if (nav.patchedRelativePath) {
    return {
      attempted: true,
      patchedRelativePath: nav.patchedRelativePath,
    };
  }
  if (navPlacementAgent) {
    try {
      const ag = await navPlacementAgent({
        repoRoot,
        appPackagePrefix,
        demoPages,
        routerRelativePath,
      });
      if (ag?.warnings?.length) {
        warnings.push(...ag.warnings);
      }
      if (ag?.patchedRelativePath) {
        return {
          attempted: true,
          patchedRelativePath: ag.patchedRelativePath,
        };
      }
    } catch (e) {
      warnings.push(`FlowX demo nav agent: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return {
    attempted: nav.attempted,
    patchedRelativePath: undefined,
  };
}

/** Infer `apps/<app>/` or `packages/<pkg>/` when demo files live under a monorepo package. */
export function inferMonorepoAppPrefix(firstDemoFilePath: string): string {
  const m = firstDemoFilePath.match(/^(?:apps|packages)[/\\][^/\\]+[/\\]/);
  if (!m) {
    return '';
  }
  return m[0].replace(/\\/g, '/');
}

export function normalizeDemoRoutePath(route: string): string {
  return route.trim().replace(/^\/+/, '');
}

/** Import path from router dir to a page file, both relative to repo root (POSIX). */
export function routerRelativeImport(routerFileRel: string, pageFileRel: string): string {
  const routerDir = dirname(routerFileRel.replace(/\\/g, '/'));
  const pagePosix = pageFileRel.replace(/\\/g, '/');
  const pageDir = dirname(pagePosix);
  const base = pagePosix.split('/').pop() ?? '';
  const stem = base.replace(/\.tsx?$/, '');
  const pagePathNoExt =
    !pageDir || pageDir === '.' ? stem : `${pageDir}/${stem}`;
  let rel = relative(routerDir, pagePathNoExt).replace(/\\/g, '/');
  if (!rel || rel === '') {
    return `./${stem}`;
  }
  if (!rel.startsWith('.')) {
    rel = `./${rel}`;
  }
  return rel;
}

export function buildRouteTrie(demoPages: DemoPage[]): RouteTrieNode {
  const root: RouteTrieNode = { segment: '', children: new Map() };
  for (const page of demoPages) {
    const segments = normalizeDemoRoutePath(page.route)
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) {
      continue;
    }
    let cur = root;
    for (const seg of segments) {
      if (!cur.children.has(seg)) {
        cur.children.set(seg, { segment: seg, children: new Map() });
      }
      cur = cur.children.get(seg)!;
    }
    cur.page = page;
  }
  return root;
}

function sortedTrieChildren(node: RouteTrieNode): RouteTrieNode[] {
  return Array.from(node.children.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((k) => node.children.get(k)!);
}

function collectDemoPagesFromTrie(node: RouteTrieNode, acc: DemoPage[]): void {
  if (node.page) {
    acc.push(node.page);
  }
  for (const c of sortedTrieChildren(node)) {
    collectDemoPagesFromTrie(c, acc);
  }
}

/** Returns true if any branch uses `<Outlet />`. */
function emitTrieBranch(node: RouteTrieNode, indent: string): { text: string; usesOutlet: boolean } {
  const hasKids = node.children.size > 0;
  const hasPage = !!node.page;
  const sorted = sortedTrieChildren(node);

  if (!hasKids && hasPage && node.page) {
    return {
      text: `${indent}{ path: '${node.segment}', element: <${node.page.componentName} /> }`,
      usesOutlet: false,
    };
  }

  if (hasKids && !hasPage) {
    const innerParts: string[] = [];
    for (const ch of sorted) {
      innerParts.push(emitTrieBranch(ch, `${indent}  `).text);
    }
    const inner = innerParts.join(',\n');
    return {
      text: `${indent}{ path: '${node.segment}', element: <Outlet />, children: [\n${inner}\n${indent}] }`,
      usesOutlet: true,
    };
  }

  if (hasKids && hasPage && node.page) {
    const indexLine = `${indent}  { index: true, element: <${node.page.componentName} /> }`;
    const innerParts: string[] = [];
    for (const ch of sorted) {
      innerParts.push(emitTrieBranch(ch, `${indent}  `).text);
    }
    const inner = [indexLine, ...innerParts].join(',\n');
    return {
      text: `${indent}{ path: '${node.segment}', element: <Outlet />, children: [\n${inner}\n${indent}] }`,
      usesOutlet: true,
    };
  }

  throw new Error(
    `FLOWX_DEMO_ROUTE_TRIE_INVALID: missing page or children for segment "${node.segment}"`,
  );
}

export function buildFlowxDemoRoutesGeneratedSource(
  demoPages: DemoPage[],
  routerFileRel: string,
): string {
  const trie = buildRouteTrie(demoPages);
  const pagesInOrder: DemoPage[] = [];
  collectDemoPagesFromTrie(trie, pagesInOrder);
  const seen = new Set<string>();
  const uniqueImports: DemoPage[] = [];
  for (const p of pagesInOrder) {
    const key = `${p.componentName}\0${p.filePath}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueImports.push(p);
    }
  }

  const header: string[] = [
    '/**',
    ' * Auto-generated by FlowX when demo pages are written. Do not edit by hand.',
    ' * Nested RouteObject tree for React Router 6 (shared path prefixes + Outlet).',
    ' */',
    '',
    "import type { RouteObject } from 'react-router-dom';",
  ];

  let needsOutlet = false;
  const topBranches = sortedTrieChildren(trie);
  const routeParts: string[] = [];
  for (const br of topBranches) {
    const sub = emitTrieBranch(br, '  ');
    routeParts.push(sub.text);
    if (sub.usesOutlet) {
      needsOutlet = true;
    }
  }

  if (needsOutlet) {
    header.push("import { Outlet } from 'react-router-dom';");
  }

  for (const p of uniqueImports) {
    const spec = routerRelativeImport(routerFileRel, p.filePath);
    header.push(`import { ${p.componentName} } from '${spec}';`);
  }

  const body =
    routeParts.length > 0
      ? [`export const flowxDemoRouteObjects: RouteObject[] = [`, routeParts.join(',\n'), `];`, '']
      : [`export const flowxDemoRouteObjects: RouteObject[] = [];`, ''];

  return [...header, '', ...body].join('\n');
}

/** Match common React Router v6 Data Router entry patterns (project-agnostic). */
const ROUTE_ARRAY_ANCHORS: RegExp[] = [
  /const\s+routes\s*:\s*RouteObject\[\]\s*=\s*\[/,
  /const\s+(?:appRoutes|routeConfig|routerRoutes|routeTable|rootRoutes)\s*:\s*RouteObject\[\]\s*=\s*\[/,
  /const\s+routes\s*=\s*\[/,
];

export type RouterPatchStrategy =
  | 'routes_typed'
  | 'named_route_array'
  | 'routes_untyped'
  | 'none';

export function insertFlowxDemoSpreadIntoRoutes(content: string): {
  content: string;
  changed: boolean;
  strategy: RouterPatchStrategy;
} {
  const marker = '...flowxDemoRouteObjects';
  if (content.includes(marker)) {
    return { content, changed: false, strategy: 'none' };
  }

  const textHint =
    content.includes('RouteObject') ||
    content.includes('react-router-dom') ||
    content.includes('@react-router');

  for (let i = 0; i < ROUTE_ARRAY_ANCHORS.length; i++) {
    const anchor = ROUTE_ARRAY_ANCHORS[i];
    const m = content.match(anchor);
    if (!m || m.index === undefined) {
      continue;
    }
    if (anchor.source.includes('routes\\s*=\\s*\\[') && !textHint) {
      continue;
    }
    const afterAnchor = content.slice(m.index + m[0].length);
    const childrenIdx = afterAnchor.indexOf('children: [');
    if (childrenIdx === -1) {
      continue;
    }
    const insertPos = m.index + m[0].length + childrenIdx + 'children: ['.length;
    const insertion = '\n      ...flowxDemoRouteObjects,\n';
    const strategy: RouterPatchStrategy =
      i === 0 ? 'routes_typed' : i === 1 ? 'named_route_array' : 'routes_untyped';
    return {
      content: content.slice(0, insertPos) + insertion + content.slice(insertPos),
      changed: true,
      strategy,
    };
  }

  return { content, changed: false, strategy: 'none' };
}

const FLOWX_IMPORT_RE =
  /import\s*\{\s*flowxDemoRouteObjects\s*\}\s*from\s*['"]\.\/flowx-demo-routes\.generated['"]\s*;?\s*\n?/;

/** Import path from router entry to generated module (generated file is always alongside the router file). */
export function flowxDemoGeneratedImportSpecifier(_routerFileRel: string, _generatedRel: string): string {
  return './flowx-demo-routes.generated';
}

export function ensureFlowxDemoImportLine(
  content: string,
  importSpecifier: string = './flowx-demo-routes.generated',
): { content: string; changed: boolean } {
  const quoted = importSpecifier.replace(/\\/g, '/');
  if (
    FLOWX_IMPORT_RE.test(content) ||
    content.includes('flowx-demo-routes.generated') ||
    content.includes(quoted)
  ) {
    return { content, changed: false };
  }
  const importLine = `import { flowxDemoRouteObjects } from '${quoted}';\n`;
  const lines = content.split(/\r?\n/);
  let lastImport = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('import ') || t.startsWith('import\t')) {
      lastImport = i;
    }
  }
  if (lastImport === -1) {
    return { content: importLine + content, changed: true };
  }
  lines.splice(lastImport + 1, 0, importLine.trimEnd());
  return { content: lines.join('\n'), changed: true };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function fileLooksLikeReactRouterDataApi(source: string): boolean {
  return (
    /createBrowserRouter\s*\(/.test(source) ||
    /createHashRouter\s*\(/.test(source) ||
    /createMemoryRouter\s*\(/.test(source)
  );
}

async function isRouterEntryFile(repoRoot: string, relativePath: string): Promise<boolean> {
  const abs = join(repoRoot, relativePath);
  if (!(await pathExists(abs))) {
    return false;
  }
  try {
    const text = await readFile(abs, 'utf8');
    return fileLooksLikeReactRouterDataApi(text);
  } catch {
    return false;
  }
}

function scoreRouterCandidate(relPath: string, preferredPrefix: string): number {
  const posix = relPath.replace(/\\/g, '/');
  const p = preferredPrefix.replace(/\\/g, '/');
  let score = 0;
  if (p && posix.startsWith(p)) {
    score += 40;
  }
  if (/\/router\//.test(posix) || posix.endsWith('/router.tsx') || posix.endsWith('/router.ts')) {
    score += 25;
  }
  if (/\/routes\//.test(posix) || /\/routes\.tsx?$/.test(posix)) {
    score += 18;
  }
  if (/\/src\/router\//.test(posix)) {
    score += 15;
  }
  if (posix.endsWith('/router/index.tsx') || posix.endsWith('/router/index.ts')) {
    score += 12;
  }
  score -= Math.min(posix.split('/').length, 12);
  return score;
}

const ROUTER_SCAN_SKIP = new Set([
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

async function collectTsFilesUnder(maxFiles: number, rootDir: string, maxDepth: number): Promise<string[]> {
  const out: string[] = [];
  type Frame = { dir: string; depth: number };
  const stack: Frame[] = [{ dir: rootDir, depth: 0 }];

  while (stack.length > 0 && out.length < maxFiles) {
    const { dir, depth } = stack.pop()!;
    if (depth > maxDepth) {
      continue;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ROUTER_SCAN_SKIP.has(ent.name)) {
        continue;
      }
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push({ dir: abs, depth: depth + 1 });
      } else if (
        ent.name.endsWith('.tsx') ||
        (ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts'))
      ) {
        out.push(abs);
      }
    }
  }
  return out;
}

async function discoverScanRoots(repoRoot: string, preferredAppPrefix: string): Promise<string[]> {
  const roots = new Set<string>();
  roots.add(repoRoot);

  const pref = preferredAppPrefix.replace(/\\/g, '/').replace(/\/$/, '');
  if (pref) {
    roots.add(join(repoRoot, pref));
  }

  for (const leaf of ['apps', 'packages']) {
    const base = join(repoRoot, leaf);
    try {
      const ents = await readdir(base, { withFileTypes: true });
      for (const e of ents) {
        if (e.isDirectory() && !ROUTER_SCAN_SKIP.has(e.name)) {
          roots.add(join(base, e.name));
        }
      }
    } catch {
      continue;
    }
  }

  const expanded = new Set<string>();
  for (const r of roots) {
    expanded.add(r);
    const srcChild = join(r, 'src');
    if (await pathExists(srcChild)) {
      expanded.add(srcChild);
    }
  }

  return Array.from(expanded);
}

async function discoverReactRouterEntryByScan(
  repoRoot: string,
  preferredPrefix: string,
): Promise<string | null> {
  const scanRoots = await discoverScanRoots(repoRoot, preferredPrefix);
  let best: { rel: string; score: number } | null = null;

  for (const root of scanRoots) {
    if (!(await pathExists(root))) {
      continue;
    }
    const files = await collectTsFilesUnder(220, root, 14);
    for (const abs of files) {
      let text: string;
      try {
        text = await readFile(abs, 'utf8');
      } catch {
        continue;
      }
      if (!fileLooksLikeReactRouterDataApi(text)) {
        continue;
      }
      const rel = relative(repoRoot, abs).replace(/\\/g, '/');
      const score = scoreRouterCandidate(rel, preferredPrefix);
      if (!best || score > best.score) {
        best = { rel, score };
      }
    }
  }

  return best?.rel ?? null;
}

/** Explicit paths first (fast), then shallow scan — works across monorepos and single-package repos. */
export async function discoverReactRouterEntry(
  repoRoot: string,
  preferredAppPrefix: string,
): Promise<string | null> {
  const candidates: string[] = [];
  const p = preferredAppPrefix.replace(/\\/g, '/');
  if (p) {
    candidates.push(
      `${p}src/router/index.tsx`,
      `${p}src/router/index.ts`,
      `${p}src/routes/index.tsx`,
      `${p}src/routes/index.ts`,
    );
  }
  candidates.push(
    'src/router/index.tsx',
    'src/router/index.ts',
    'src/routes/index.tsx',
    'src/routes/index.ts',
  );

  for (const rel of candidates) {
    const posix = rel.replace(/\\/g, '/');
    if (await isRouterEntryFile(repoRoot, posix)) {
      return posix;
    }
  }

  return discoverReactRouterEntryByScan(repoRoot, preferredAppPrefix);
}

function buildManualHookMarkdown(
  routerRel: string,
  generatedRel: string,
  importSpecifier: string,
): string {
  return `# FlowX Demo — wire routes (any React Router 6 project)

FlowX generated **${generatedRel}** exporting \`flowxDemoRouteObjects\`.

Automatic patching failed or was skipped for **${routerRel}**. Add these lines yourself (adjust the import path if your router file lives elsewhere):

\`\`\`tsx
import { flowxDemoRouteObjects } from '${importSpecifier}';

// Inside your root layout route's \`children\` array (first item is fine):
children: [
  ...flowxDemoRouteObjects,
  // ...existing routes
],
\`\`\`

Requirements:

- **react-router-dom** v6 Data Router (\`createBrowserRouter\` / \`createHashRouter\`).
- Demo pages use **named exports**; \`route\` paths share one prefix (e.g. \`flowx-demo\`, \`flowx-demo/sub\`) so generated routes nest correctly.

`;
}

/**
 * Writes flowx-demo-routes.generated.tsx and patches the primary router file when the repo matches common patterns.
 */
export async function integrateFlowxDemoRoutes(
  repoRoot: string,
  demoPages: DemoPage[],
  options?: IntegrateFlowxDemoRoutesOptions,
): Promise<DemoRouterIntegrationResult> {
  const warnings: string[] = [];
  const normalizedRoutes = demoPages.map((p) => normalizeDemoRoutePath(p.route));

  if (demoPages.length === 0) {
    return { ok: false, normalizedRoutes, warnings: ['No demo pages to integrate.'] };
  }

  const prefix = inferMonorepoAppPrefix(demoPages[0].filePath);
  const routerRel = await discoverReactRouterEntry(repoRoot, prefix);

  if (!routerRel) {
    warnings.push(
      'FLOWX_DEMO_ROUTER_NOT_FOUND: No file using createBrowserRouter/createHashRouter/createMemoryRouter was found under this clone. Demo pages were written; add React Router 6 routes manually or place your router entry under src/router or src/routes.',
    );
    await writeFallbackArtifacts(repoRoot, demoPages, warnings);
    const navMenuPatch = await mergeNavIntegration(
      repoRoot,
      prefix,
      demoPages,
      warnings,
      undefined,
      options?.navPlacementAgent,
    );
    return { ok: false, normalizedRoutes, warnings, navMenuPatch };
  }

  const routerAbs = join(repoRoot, routerRel);
  const generatedRel = join(dirname(routerRel), `${GENERATED_MODULE_BASENAME}.tsx`).replace(/\\/g, '/');
  const importSpec = flowxDemoGeneratedImportSpecifier(routerRel, generatedRel);

  let routerSource: string;
  try {
    routerSource = await readFile(routerAbs, 'utf8');
  } catch {
    warnings.push(`Failed to read router file: ${routerRel}`);
    await writeFallbackArtifacts(repoRoot, demoPages, warnings);
    const navMenuPatch = await mergeNavIntegration(
      repoRoot,
      prefix,
      demoPages,
      warnings,
      routerRel,
      options?.navPlacementAgent,
    );
    return { ok: false, normalizedRoutes, warnings, navMenuPatch };
  }

  const hadSpreadAlready = routerSource.includes('...flowxDemoRouteObjects');
  const spreadResult = insertFlowxDemoSpreadIntoRoutes(routerSource);
  if (!spreadResult.changed && !hadSpreadAlready) {
    warnings.push(
      `FLOWX_DEMO_ROUTER_PATCH_SKIPPED: Could not match a known routes array + layout children: [ pattern in ${routerRel}. See FLOWX_DEMO_ROUTER_HOOK.md in the same folder as the generated routes file.`,
    );
  }

  let patchedRouter = spreadResult.changed ? spreadResult.content : routerSource;
  if (spreadResult.changed || hadSpreadAlready) {
    const imp = ensureFlowxDemoImportLine(patchedRouter, importSpec);
    patchedRouter = imp.content;
    if (spreadResult.changed || imp.changed) {
      await writeFile(routerAbs, patchedRouter, 'utf8');
    }
  }

  const generatedSource = buildFlowxDemoRoutesGeneratedSource(demoPages, routerRel);
  await writeFile(join(repoRoot, generatedRel), generatedSource, 'utf8');

  if (!spreadResult.changed && !hadSpreadAlready) {
    const hookPath = join(repoRoot, dirname(generatedRel), 'FLOWX_DEMO_ROUTER_HOOK.md');
    await writeFile(
      hookPath,
      buildManualHookMarkdown(routerRel, generatedRel, importSpec),
      'utf8',
    );
  }

  const navMenuPatch = await mergeNavIntegration(
    repoRoot,
    prefix,
    demoPages,
    warnings,
    routerRel,
    options?.navPlacementAgent,
  );

  return {
    ok: true,
    routerRelativePath: routerRel,
    generatedRelativePath: generatedRel,
    normalizedRoutes,
    warnings,
    navMenuPatch,
  };
}

async function writeFallbackArtifacts(
  repoRoot: string,
  demoPages: DemoPage[],
  warnings: string[],
): Promise<void> {
  const prefix = inferMonorepoAppPrefix(demoPages[0].filePath);
  const baseDir = prefix ? `${prefix.replace(/\/$/, '')}/src/router` : 'src/router';
  const genRel = `${baseDir}/${GENERATED_MODULE_BASENAME}.tsx`.replace(/\/+/g, '/');
  const routerIndexRel = `${baseDir}/index.tsx`;
  try {
    const generatedSource = buildFlowxDemoRoutesGeneratedSource(demoPages, routerIndexRel);
    await writeFile(join(repoRoot, genRel), generatedSource, 'utf8');
    const hookPath = join(repoRoot, dirname(genRel), 'FLOWX_DEMO_ROUTER_HOOK.md');
    await writeFile(
      hookPath,
      buildManualHookMarkdown(routerIndexRel, genRel, './flowx-demo-routes.generated'),
      'utf8',
    );
    warnings.push(`Wrote ${genRel} and FLOWX_DEMO_ROUTER_HOOK.md — complete manual router wiring.`);
  } catch {
    warnings.push('Failed to write fallback demo route artifacts.');
  }
}
