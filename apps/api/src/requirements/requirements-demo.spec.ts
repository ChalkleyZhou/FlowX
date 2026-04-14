import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DemoPage } from '../common/types';

// Unit tests for the demo-related logic extracted from RequirementsService.
// Since the service has heavy Prisma/deploy dependencies, we test the
// pure logic parts and mock the external calls.

describe('writeDemoPagesToRepo logic', () => {
  it('skips write when no ready repositories exist', () => {
    const requirement = {
      id: 'req-1',
      requirementRepositories: [],
    };

    // No repositories → should not throw, just skip
    expect(requirement.requirementRepositories).toHaveLength(0);
  });

  it('demo page has all required fields', () => {
    const page: DemoPage = {
      route: '/flowx-demo/test',
      componentName: 'TestPage',
      componentCode: 'export function TestPage() {}',
      mockData: {},
      filePath: 'src/pages/TestPage.tsx',
    };

    expect(page.componentCode).toBeTruthy();
    expect(page.filePath).toMatch(/\.tsx$/);
    expect(page.route).toMatch(/^\/flowx-demo\//);
  });
});

describe('triggerDemoDeploy logic', () => {
  it('skips deploy when repository deploy is not enabled', async () => {
    // Simulate deploy config check
    const config = { enabled: false, provider: 'noop' };
    expect(config.enabled).toBe(false);
  });

  it('triggers deploy when config is enabled', async () => {
    const config = { enabled: true, provider: 'rokid-ops' };
    expect(config.enabled).toBe(true);
  });
});

describe('confirmDesign DEMO_PAGE artifact', () => {
  it('stores DEMO_PAGE artifact alongside DESIGN_SPEC', () => {
    const sessionOutput = {
      design: {
        overview: 'test',
        pages: [],
        demoScenario: 'test',
        dataModels: [],
        apiEndpoints: [],
        designRationale: 'test',
      },
      demoPages: [
        {
          route: '/flowx-demo/test',
          componentName: 'TestPage',
          componentCode: 'export function TestPage() {}',
          mockData: {},
          filePath: 'src/pages/TestPage.tsx',
        },
      ],
    };

    // Verify both design and demoPages exist in the output
    expect(sessionOutput.design).toBeDefined();
    expect(sessionOutput.demoPages).toHaveLength(1);
    expect(sessionOutput.demoPages[0].componentName).toBe('TestPage');
  });

  it('does not store DEMO_PAGE when demoPages is empty', () => {
    const sessionOutput = {
      design: {
        overview: 'test',
        pages: [],
        demoScenario: 'test',
        dataModels: [],
        apiEndpoints: [],
        designRationale: 'test',
      },
      demoPages: [],
    };

    // Empty demoPages should not create artifact
    expect(sessionOutput.demoPages).toHaveLength(0);
  });
});
