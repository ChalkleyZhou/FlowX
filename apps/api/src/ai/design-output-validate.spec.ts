import { describe, expect, it } from 'vitest';
import { assertDesignSpecOutput, assertStrictGenerateDesignOutput } from './design-output-validate';

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

const designPhaseValid = {
  design: minimalValid.design,
  demo: minimalValid.demo,
  surfaces: [
    {
      id: 'Web端',
      pages: [
        {
          id: 'index',
          title: '首页',
          html: '<!doctype html><html><body><h1>Design</h1></body></html>',
        },
      ],
    },
  ],
};

describe('assertDesignSpecOutput', () => {
  it('accepts design + demo + surfaces without demoPages', () => {
    const out = assertDesignSpecOutput(designPhaseValid);
    expect(out.surfaces[0]?.id).toBe('Web端');
    expect(out.surfaces[0]?.pages[0]?.html).toContain('<!doctype html>');
    expect(out.demoPages).toBeUndefined();
  });

  it('keeps demoPages when the agent also returns them', () => {
    const out = assertDesignSpecOutput({ ...designPhaseValid, demoPages: minimalValid.demoPages });
    expect(out.demoPages).toHaveLength(2);
  });

  it('rejects missing or empty surfaces', () => {
    const { surfaces: _s, ...rest } = designPhaseValid;
    expect(() => assertDesignSpecOutput(rest)).toThrow(/surfaces/);
    expect(() => assertDesignSpecOutput({ ...designPhaseValid, surfaces: [] })).toThrow(/surfaces/);
  });

  it('rejects legacy designArtifact without surfaces', () => {
    const { surfaces: _s, ...rest } = designPhaseValid;
    expect(() =>
      assertDesignSpecOutput({
        ...rest,
        designArtifact: { html: '<!doctype html><html></html>' },
      }),
    ).toThrow(/designArtifact is removed/);
  });

  it('rejects empty page html', () => {
    expect(() =>
      assertDesignSpecOutput({
        ...designPhaseValid,
        surfaces: [{ id: 'Web端', pages: [{ id: 'index', html: '' }] }],
      }),
    ).toThrow(/html/);
  });

  it('still requires a valid design and demo', () => {
    expect(() =>
      assertDesignSpecOutput({ ...designPhaseValid, design: { ...minimalValid.design, overview: '' } }),
    ).toThrow(/design\.overview/);
  });
});
