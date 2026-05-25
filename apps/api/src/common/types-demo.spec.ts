import { describe, expect, it } from 'vitest';
import type { DemoPage, GenerateDesignOutput, RepositoryComponentContext } from './types';

describe('GenerateDesignOutput with demoPages', () => {
  it('accepts output with demoPages', () => {
    const output: GenerateDesignOutput = {
      design: {
        overview: 'test',
        pages: [],
        demoScenario: 'test',
        designRationale: 'test',
      },
      demo: {
        summary: '验证核心流程',
        flows: [
          {
            name: '创建流程',
            goal: '验证创建成功',
            entry: '列表页右上角',
            states: ['空态', '提交成功'],
          },
        ],
        scope: {
          included: ['列表', '创建弹窗'],
          excluded: ['批量操作'],
        },
        knownGaps: ['使用 mock 数据'],
      },
      demoPages: [
        {
          route: 'flowx-demo',
          componentName: 'HubDemoPage',
          componentCode: 'export function HubDemoPage() { return <div />; }',
          mockData: {},
          filePath: 'src/pages/flowx-demo/HubDemoPage.tsx',
        },
        {
          route: '/flowx-demo/test',
          componentName: 'TestDemoPage',
          componentCode: 'export function TestDemoPage() { return <div />; }',
          mockData: { items: [] },
          filePath: 'src/pages/TestDemoPage.tsx',
        },
      ],
    };

    expect(output.demoPages).toHaveLength(2);
    expect(output.demo.summary).toBe('验证核心流程');
    expect(output.demoPages[0].componentName).toBe('HubDemoPage');
    expect(output.demoPages[1].componentName).toBe('TestDemoPage');
  });
});

describe('DemoPage type', () => {
  it('includes all required fields', () => {
    const page: DemoPage = {
      route: '/flowx-demo/orders',
      componentName: 'OrderDemoPage',
      componentCode: 'export function OrderDemoPage() {}',
      mockData: { orders: [{ id: '1' }] },
      filePath: 'src/pages/OrderDemoPage.tsx',
    };

    expect(page.route).toBe('/flowx-demo/orders');
    expect(page.filePath).toBe('src/pages/OrderDemoPage.tsx');
    expect(page.mockData).toEqual({ orders: [{ id: '1' }] });
  });
});

describe('RepositoryComponentContext type', () => {
  it('includes all fields', () => {
    const ctx: RepositoryComponentContext = {
      componentFiles: ['src/components/Button.tsx'],
      propTypes: [{ name: 'Button', props: 'variant: string' }],
      pageExamples: [{ path: 'src/pages/Home.tsx', code: 'export function Home() {}' }],
      designTokens: '// tokens.css\n--primary: blue;',
    };

    expect(ctx.componentFiles).toHaveLength(1);
    expect(ctx.propTypes[0].name).toBe('Button');
    expect(ctx.designTokens).toBeDefined();
  });

  it('works without optional designTokens', () => {
    const ctx: RepositoryComponentContext = {
      componentFiles: [],
      propTypes: [],
      pageExamples: [],
    };

    expect(ctx.designTokens).toBeUndefined();
  });
});
