import { describe, expect, it } from 'vitest';
import type { FlowXDesignOutput, OpenDesignContextPackage } from './design.js';

describe('FlowXDesignOutput surfaces contract', () => {
  it('types require surfaces with pages html', () => {
    const output: FlowXDesignOutput = {
      design: {},
      demo: {},
      surfaces: [
        {
          id: 'Web端',
          pages: [{ id: '首页', title: '首页', html: '<!doctype html><html></html>' }],
        },
      ],
    };
    expect(output.surfaces[0].id).toBe('Web端');
    expect(output.surfaces[0].pages[0].html).toContain('doctype');
  });

  it('handoff requiredFields list design demo surfaces', () => {
    const requiredFields: OpenDesignContextPackage['outputContract']['requiredFields'] = [
      'design',
      'demo',
      'surfaces',
    ];
    expect(requiredFields).not.toContain('designArtifact');
  });
});
