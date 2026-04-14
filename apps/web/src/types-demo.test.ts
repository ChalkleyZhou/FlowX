import { describe, expect, it } from 'vitest';
import type { DemoPage, IdeationArtifact } from './types';

describe('DemoPage type', () => {
  it('includes previewUrl as optional field', () => {
    const page: DemoPage = {
      route: '/flowx-demo/test',
      componentName: 'TestPage',
      componentCode: 'export function TestPage() {}',
      mockData: {},
      filePath: 'src/pages/TestPage.tsx',
      previewUrl: 'https://preview.example.com',
    };

    expect(page.previewUrl).toBe('https://preview.example.com');
  });

  it('works without previewUrl', () => {
    const page: DemoPage = {
      route: '/flowx-demo/test',
      componentName: 'TestPage',
      componentCode: 'export function TestPage() {}',
      mockData: {},
      filePath: 'src/pages/TestPage.tsx',
    };

    expect(page.previewUrl).toBeUndefined();
  });
});

describe('IdeationArtifact with DEMO_PAGE', () => {
  it('supports DEMO_PAGE type', () => {
    const artifact: IdeationArtifact = {
      id: 'artifact-1',
      type: 'DEMO_PAGE',
      content: [
        {
          route: '/flowx-demo/test',
          componentName: 'TestPage',
          componentCode: 'export function TestPage() {}',
          mockData: {},
          filePath: 'src/pages/TestPage.tsx',
          previewUrl: 'https://preview.example.com',
        },
      ],
      version: 1,
      createdAt: '2026-04-13T00:00:00Z',
    };

    expect(artifact.type).toBe('DEMO_PAGE');
  });
});
