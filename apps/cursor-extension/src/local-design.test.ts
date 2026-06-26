import { describe, expect, it, vi } from 'vitest';
import {
  buildLocalDesignPrompt,
  generateLocalDesign,
  localDesignRelPath,
  parseLocalDesignSubmission,
  submitLocalDesignFromFile,
  type GenerateLocalDesignDeps,
  type SubmitLocalDesignDeps,
} from './local-design';
import type { FlowXTaskItem } from './flowx-client';

const task: FlowXTaskItem = {
  id: 'req-1',
  type: 'requirement',
  title: '导出 CSV',
  status: 'active',
  repository: { id: 'repo-1', name: 'flowx-web', url: 'git@x:flowx.git' },
  workflowRunId: 'run-1',
  eligible: true,
};

const validJson = JSON.stringify({
  design: { overview: 'o', pages: [], demoScenario: 'd', designRationale: 'r' },
  demo: { summary: 's', flows: [], scope: { included: [], excluded: [] }, knownGaps: [] },
  designArtifact: { html: '<!doctype html><html></html>' },
});

describe('parseLocalDesignSubmission', () => {
  it('accepts a well-formed submission', () => {
    expect(parseLocalDesignSubmission(validJson)).not.toBeNull();
  });

  it('rejects invalid JSON, missing parts, or empty html', () => {
    expect(parseLocalDesignSubmission('{not json')).toBeNull();
    expect(parseLocalDesignSubmission(JSON.stringify({ design: {}, demo: {} }))).toBeNull();
    expect(
      parseLocalDesignSubmission(JSON.stringify({ design: {}, demo: {}, designArtifact: { html: '' } })),
    ).toBeNull();
  });
});

describe('buildLocalDesignPrompt', () => {
  it('references od mcp and the target output path', () => {
    const prompt = buildLocalDesignPrompt(task, 'run-1', localDesignRelPath('run-1'));
    expect(prompt).toContain('OpenDesign MCP');
    expect(prompt).toContain('.flowx/design/run-1.json');
    expect(prompt).toContain('designArtifact');
  });
});

describe('generateLocalDesign', () => {
  function deps(overrides: Partial<GenerateLocalDesignDeps> = {}): GenerateLocalDesignDeps {
    return {
      getGitRoot: vi.fn().mockResolvedValue('/repo'),
      buildPrompt: vi.fn().mockReturnValue('PROMPT'),
      copyToClipboard: vi.fn().mockResolvedValue(undefined),
      openPromptInChat: vi.fn().mockResolvedValue(true),
      showError: vi.fn(),
      showInfo: vi.fn(),
      ...overrides,
    };
  }

  it('opens the prompt in chat when a git workspace is available', async () => {
    const d = deps();
    await generateLocalDesign(d, task);
    expect(d.openPromptInChat).toHaveBeenCalledWith('PROMPT');
    expect(d.showInfo).toHaveBeenCalled();
  });

  it('errors without a git workspace', async () => {
    const d = deps({ getGitRoot: vi.fn().mockResolvedValue(null) });
    await generateLocalDesign(d, task);
    expect(d.openPromptInChat).not.toHaveBeenCalled();
    expect(d.showError).toHaveBeenCalled();
  });
});

describe('submitLocalDesignFromFile', () => {
  function deps(overrides: Partial<SubmitLocalDesignDeps> = {}): SubmitLocalDesignDeps {
    return {
      getGitRoot: vi.fn().mockResolvedValue('/repo'),
      readDesignFile: vi.fn().mockResolvedValue(validJson),
      submit: vi.fn().mockResolvedValue({}),
      showError: vi.fn(),
      showInfo: vi.fn(),
      ...overrides,
    };
  }

  it('submits a valid agent-written design', async () => {
    const d = deps();
    await submitLocalDesignFromFile(d, 'run-1');
    expect(d.submit).toHaveBeenCalledWith('run-1', expect.objectContaining({ designArtifact: expect.any(Object) }));
    expect(d.showInfo).toHaveBeenCalled();
  });

  it('errors when the design file is missing', async () => {
    const d = deps({ readDesignFile: vi.fn().mockResolvedValue(null) });
    await submitLocalDesignFromFile(d, 'run-1');
    expect(d.submit).not.toHaveBeenCalled();
    expect(d.showError).toHaveBeenCalled();
  });

  it('errors when the design file is malformed', async () => {
    const d = deps({ readDesignFile: vi.fn().mockResolvedValue('{bad') });
    await submitLocalDesignFromFile(d, 'run-1');
    expect(d.submit).not.toHaveBeenCalled();
    expect(d.showError).toHaveBeenCalled();
  });
});
