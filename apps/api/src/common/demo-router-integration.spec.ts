import { describe, expect, it } from 'vitest';
import {
  buildFlowxDemoRoutesGeneratedSource,
  ensureFlowxDemoImportLine,
  inferMonorepoAppPrefix,
  insertFlowxDemoSpreadIntoRoutes,
  normalizeDemoRoutePath,
  routerRelativeImport,
} from './demo-router-integration';
import type { DemoPage } from './types';

describe('routerRelativeImport', () => {
  it('resolves monorepo app page from router', () => {
    expect(
      routerRelativeImport(
        'apps/admin-app/src/router/index.tsx',
        'apps/admin-app/src/pages/flowx-demo/FooDemo.tsx',
      ),
    ).toBe('../pages/flowx-demo/FooDemo');
  });
});

describe('insertFlowxDemoSpreadIntoRoutes', () => {
  it('inserts spread after first children: [ under const routes: RouteObject[]', () => {
    const input = `import { x } from 'x';
const routes: RouteObject[] = [
  {
    path: \`\`,
    element: <Layout />,
    children: [
      { path: 'home', element: <H /> },
    ],
  },
];
export default routes;
`;
    const { content, changed } = insertFlowxDemoSpreadIntoRoutes(input);
    expect(changed).toBe(true);
    expect(content).toContain('...flowxDemoRouteObjects');
    expect(content.indexOf('...flowxDemoRouteObjects')).toBeLessThan(content.indexOf("path: 'home'"));
  });

  it('matches alternate RouteObject array names', () => {
    const input = `import type { RouteObject } from 'react-router-dom';
const appRoutes: RouteObject[] = [
  {
    path: '',
    element: <Shell />,
    children: [
      { path: 'x', element: <X /> },
    ],
  },
];
`;
    const { content, changed } = insertFlowxDemoSpreadIntoRoutes(input);
    expect(changed).toBe(true);
    expect(content).toContain('...flowxDemoRouteObjects');
  });
});

describe('ensureFlowxDemoImportLine', () => {
  it('adds import after last import', () => {
    const { content, changed } = ensureFlowxDemoImportLine("import a from 'a';\nconst x = 1;\n");
    expect(changed).toBe(true);
    expect(content).toContain("from './flowx-demo-routes.generated'");
  });

  it('is idempotent when import exists', () => {
    const src = "import { flowxDemoRouteObjects } from './flowx-demo-routes.generated';\n";
    const { content, changed } = ensureFlowxDemoImportLine(src);
    expect(changed).toBe(false);
    expect(content).toBe(src);
  });
});

describe('buildFlowxDemoRoutesGeneratedSource', () => {
  it('nests multi-segment routes under one prefix (React Router 6)', () => {
    const pages: DemoPage[] = [
      {
        route: '/flowx-demo/a',
        componentName: 'DemoA',
        componentCode: '',
        mockData: {},
        filePath: 'apps/admin-app/src/pages/demos/A.tsx',
      },
    ];
    const src = buildFlowxDemoRoutesGeneratedSource(pages, 'apps/admin-app/src/router/index.tsx');
    expect(src).toContain('export const flowxDemoRouteObjects');
    expect(src).toContain("path: 'flowx-demo'");
    expect(src).toContain("path: 'a'");
    expect(src).toContain('<Outlet />');
    expect(src).toContain('<DemoA />');
    expect(src).toContain("import { DemoA } from '../pages/demos/A'");
  });

  it('uses index + children when hub and sub-page share a prefix', () => {
    const pages: DemoPage[] = [
      {
        route: 'flowx-demo',
        componentName: 'HubPage',
        componentCode: '',
        mockData: {},
        filePath: 'apps/admin-app/src/pages/flowx-demo/index.tsx',
      },
      {
        route: 'flowx-demo/notifications',
        componentName: 'NotifPage',
        componentCode: '',
        mockData: {},
        filePath: 'apps/admin-app/src/pages/flowx-demo/notifications/index.tsx',
      },
    ];
    const src = buildFlowxDemoRoutesGeneratedSource(pages, 'apps/admin-app/src/router/index.tsx');
    expect(src).toContain('index: true');
    expect(src).toContain('<HubPage />');
    expect(src).toContain("path: 'notifications'");
    expect(src).toContain('<NotifPage />');
    expect(src).not.toContain("path: 'flowx-demo/notifications'");
  });
});

describe('inferMonorepoAppPrefix', () => {
  it('detects apps/foo/', () => {
    expect(inferMonorepoAppPrefix('apps/admin-app/src/pages/x.tsx')).toBe('apps/admin-app/');
  });

  it('detects packages/foo/', () => {
    expect(inferMonorepoAppPrefix('packages/ui-kit/src/pages/x.tsx')).toBe('packages/ui-kit/');
  });

  it('returns empty for src-root repos', () => {
    expect(inferMonorepoAppPrefix('src/pages/x.tsx')).toBe('');
  });
});

describe('normalizeDemoRoutePath', () => {
  it('strips leading slashes', () => {
    expect(normalizeDemoRoutePath('/flowx-demo/x')).toBe('flowx-demo/x');
  });
});
