import { describe, expect, it } from 'vitest';
import { assertStrictGenerateDesignOutput } from './design-output-validate';

const minimalValid = {
  design: {
    overview: 'o',
    pages: [
      {
        name: 'p',
        route: '/p',
        layout: 'l',
        keyComponents: [] as string[],
        interactions: [] as string[],
      },
    ],
    demoScenario: 'd',
    designRationale: 'r',
  },
  demo: {
    summary: 's',
    flows: [{ name: 'n', goal: 'g', entry: 'e', states: [] as string[] }],
    scope: { included: [] as string[], excluded: [] as string[] },
    knownGaps: [] as string[],
  },
  demoPages: [
    {
      route: 'flowx-demo',
      componentName: 'Hub',
      componentCode: 'export function Hub() { return null; }',
      mockData: {},
      filePath: 'src/pages/flowx-demo/Hub.tsx',
    },
    {
      route: '/flowx-demo/x',
      componentName: 'X',
      componentCode: 'export function X() { return null; }',
      mockData: {},
      filePath: 'src/pages/X.tsx',
    },
  ],
};

describe('assertStrictGenerateDesignOutput', () => {
  it('accepts output with hub + scenario demoPages', () => {
    const out = assertStrictGenerateDesignOutput(minimalValid);
    expect(out.demoPages).toHaveLength(2);
  });

  it('rejects missing, empty, or single-page demoPages', () => {
    const { demoPages: _d, ...rest } = minimalValid;
    expect(() => assertStrictGenerateDesignOutput(rest)).toThrow(/demoPages/);
    expect(() => assertStrictGenerateDesignOutput({ ...minimalValid, demoPages: [] })).toThrow(/demoPages/);
    expect(() =>
      assertStrictGenerateDesignOutput({
        ...minimalValid,
        demoPages: [minimalValid.demoPages[1]!],
      }),
    ).toThrow(/minimum 2/);
  });
});
