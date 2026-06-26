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

  it('passes through an optional designArtifact ref when present', () => {
    const out = assertStrictGenerateDesignOutput({
      ...minimalValid,
      designArtifact: { relPath: 'run-1/design.html', bytes: 10 },
    });
    expect(out.designArtifact?.relPath).toBe('run-1/design.html');
  });
});

const designPhaseValid = {
  design: minimalValid.design,
  demo: minimalValid.demo,
  designArtifact: {
    html: '<!doctype html><html><body><h1>Design</h1></body></html>',
    generatedAt: '2026-01-01T00:00:00.000Z',
  },
};

describe('assertDesignSpecOutput', () => {
  it('accepts design + demo + designArtifact.html without demoPages', () => {
    const out = assertDesignSpecOutput(designPhaseValid);
    expect(out.designArtifact.html).toContain('<!doctype html>');
    expect(out.demoPages).toBeUndefined();
  });

  it('keeps demoPages when the agent also returns them', () => {
    const out = assertDesignSpecOutput({ ...designPhaseValid, demoPages: minimalValid.demoPages });
    expect(out.demoPages).toHaveLength(2);
  });

  it('rejects a missing or empty designArtifact.html', () => {
    const { designArtifact: _a, ...rest } = designPhaseValid;
    expect(() => assertDesignSpecOutput(rest)).toThrow(/designArtifact/);
    expect(() => assertDesignSpecOutput({ ...designPhaseValid, designArtifact: { html: '' } })).toThrow(
      /designArtifact\.html/,
    );
  });

  it('still requires a valid design and demo', () => {
    expect(() => assertDesignSpecOutput({ ...designPhaseValid, design: { ...minimalValid.design, overview: '' } })).toThrow(
      /design\.overview/,
    );
  });
});
