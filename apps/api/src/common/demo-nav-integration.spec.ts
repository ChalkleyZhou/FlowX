import { describe, expect, it } from 'vitest';
import {
  resolveDemoNavMenuSpec,
  tryPatchNavMenuDataSource,
  tryPatchRouteLabelMap,
} from './demo-nav-integration';
import type { DemoPage } from './types';

function page(p: Partial<DemoPage> & Pick<DemoPage, 'route' | 'componentName' | 'componentCode' | 'filePath'>): DemoPage {
  return {
    mockData: {},
    ...p,
  };
}

describe('resolveDemoNavMenuSpec', () => {
  it('uses hub navLabel and first route segment for href', () => {
    const spec = resolveDemoNavMenuSpec([
      page({
        route: 'flowx-demo',
        navLabel: '通知中心',
        componentName: 'H',
        componentCode: 'export function H(){}',
        filePath: 'src/pages/flowx-demo/Hub.tsx',
      }),
      page({
        route: 'flowx-demo/sub',
        componentName: 'S',
        componentCode: 'export function S(){}',
        filePath: 'src/pages/flowx-demo/Sub.tsx',
      }),
    ]);
    expect(spec).toEqual({ label: '通知中心', hrefPath: '/flowx-demo' });
  });

  it('falls back to mockData.navLabel on hub', () => {
    const spec = resolveDemoNavMenuSpec([
      page({
        route: 'prefix',
        componentName: 'H',
        componentCode: 'export function H(){}',
        filePath: 'src/a.tsx',
        mockData: { navLabel: '从 mock 来' },
      }),
      page({
        route: 'prefix/x',
        componentName: 'S',
        componentCode: 'export function S(){}',
        filePath: 'src/b.tsx',
      }),
    ]);
    expect(spec).toEqual({ label: '从 mock 来', hrefPath: '/prefix' });
  });
});

describe('tryPatchNavMenuDataSource', () => {
  it('appends title/url when array uses shadcn-style items', () => {
    const src = `export const navMain = [\n  { title: 'Home', url: '/' },\n];\n`;
    const { content, changed } = tryPatchNavMenuDataSource(src, { label: 'Demo', hrefPath: '/flowx-demo' });
    expect(changed).toBe(true);
    expect(content).toContain(`{ title: "Demo", url: "/flowx-demo" }`);
  });

  it('appends name/path when array uses ant-style items', () => {
    const src = `const menuItems = [\n  { name: 'dash', path: '/dash' },\n];\n`;
    const { content, changed } = tryPatchNavMenuDataSource(src, { label: '通知中心', hrefPath: '/flowx-demo' });
    expect(changed).toBe(true);
    expect(content).toContain(`{ name: "通知中心", path: "/flowx-demo" }`);
  });

  it('no-ops when no known menu array', () => {
    const src = `export function Sidebar() { return <nav />; }\n`;
    const { content, changed } = tryPatchNavMenuDataSource(src, { label: 'X', hrefPath: '/y' });
    expect(changed).toBe(false);
    expect(content).toBe(src);
  });

  it('appends key/label/permissions for const items: ItemConfig[] = [ (antd layout menu)', () => {
    const src = `
const routeLabel = {
  '/': '首页',
} as const;
const items: ItemConfig[] = [
  {
    key: '/video/demand',
    label: '视频监控',
  },
];
`;
    const { content, changed } = tryPatchNavMenuDataSource(src, {
      label: '通知中心',
      hrefPath: '/flowx-demo',
    });
    expect(changed).toBe(true);
    expect(content).toContain('{ key: "/flowx-demo", label: "通知中心", permissions: [] }');
  });
});

describe('tryPatchRouteLabelMap', () => {
  it('inserts route entry after routeLabel = {', () => {
    const src = `const routeLabel = {\n  '/': '首页',\n} as const;\n`;
    const { content, changed } = tryPatchRouteLabelMap(src, { label: 'Demo', hrefPath: '/flowx-demo' });
    expect(changed).toBe(true);
    expect(content).toContain('"/flowx-demo": "Demo"');
  });

  it('no-ops when key exists', () => {
    const src = `const routeLabel = { '/flowx-demo': 'x' };\n`;
    const { content, changed } = tryPatchRouteLabelMap(src, { label: 'Y', hrefPath: '/flowx-demo' });
    expect(changed).toBe(false);
    expect(content).toBe(src);
  });
});
