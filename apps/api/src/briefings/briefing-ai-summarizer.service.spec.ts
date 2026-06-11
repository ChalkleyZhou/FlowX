import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefingAiSummarizerService } from './briefing-ai-summarizer.service';
import type { NormalizedBriefingEvent } from './briefing-events';

function pushEvent(overrides: Partial<NormalizedBriefingEvent> = {}): NormalizedBriefingEvent {
  return {
    provider: 'gitlab',
    externalPath: 'rokid/flowx',
    externalId: '1',
    eventType: 'push',
    objectKind: 'push',
    projectName: 'flowx-api',
    action: 'push',
    subject: 'main',
    occurredAt: '2026-06-03T01:00:00.000Z',
    summary: { ref: 'main' },
    commits: [{ id: 'a1', message: 'feat(briefing): add AI summary' }],
    ...overrides,
  };
}

const aiOutput = {
  headline: '简报内容更适合项目成员阅读',
  summaryParagraph: '当天提交主要调整了简报内容组织。',
  topics: [
    {
      title: '简报内容组织调整',
      summary: '简报从提交分类调整为项目变化主题。',
      modules: ['briefing'],
      commitReferences: [{ repository: 'flowx-api', commitId: 'a1' }],
    },
  ],
  openQuestions: [],
};

describe('BriefingAiSummarizerService', () => {
  const codexRunStructuredJsonStage = vi.fn();
  const cursorRunStructuredJsonStage = vi.fn();
  const executorRegistryGet = vi.fn();
  const resolveInvocationContext = vi.fn();
  const getConfiguredDefaultProvider = vi.fn();
  const originalDisabled = process.env.FLOWX_BRIEFING_AI_DISABLED;
  const originalBriefingProvider = process.env.FLOWX_BRIEFING_AI_PROVIDER;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FLOWX_BRIEFING_AI_DISABLED;
    delete process.env.FLOWX_BRIEFING_AI_PROVIDER;
    getConfiguredDefaultProvider.mockReturnValue('codex');
    resolveInvocationContext.mockResolvedValue({ codexCredentialSource: 'instance' });
    codexRunStructuredJsonStage.mockResolvedValue(aiOutput);
    cursorRunStructuredJsonStage.mockResolvedValue(aiOutput);
    executorRegistryGet.mockImplementation((provider: string) => {
      if (provider === 'cursor') {
        return { runStructuredJsonStage: cursorRunStructuredJsonStage };
      }
      return { runStructuredJsonStage: codexRunStructuredJsonStage };
    });
  });

  afterEach(() => {
    if (originalDisabled === undefined) {
      delete process.env.FLOWX_BRIEFING_AI_DISABLED;
    } else {
      process.env.FLOWX_BRIEFING_AI_DISABLED = originalDisabled;
    }
    if (originalBriefingProvider === undefined) {
      delete process.env.FLOWX_BRIEFING_AI_PROVIDER;
    } else {
      process.env.FLOWX_BRIEFING_AI_PROVIDER = originalBriefingProvider;
    }
  });

  function createService() {
    return new BriefingAiSummarizerService(
      { get: executorRegistryGet } as never,
      {
        resolveInvocationContext,
        getConfiguredDefaultProvider,
      } as never,
    );
  }

  it('uses Codex when AI_EXECUTOR_PROVIDER defaults to codex', async () => {
    const summary = await createService().summarize({
      date: '2026-06-03',
      projectName: 'FlowX',
      events: [pushEvent()],
    });

    expect(summary.source).toBe('ai');
    expect(summary.aiProvider).toBe('codex');
    expect(codexRunStructuredJsonStage).toHaveBeenCalled();
    expect(cursorRunStructuredJsonStage).not.toHaveBeenCalled();
    expect(resolveInvocationContext).toHaveBeenCalledWith('codex', null);
    expect(summary.topics[0]?.commitReferences).toEqual([
      {
        repository: 'flowx-api',
        commitId: 'a1',
        title: 'feat(briefing): add AI summary',
      },
    ]);
  });

  it('uses Cursor when FLOWX_BRIEFING_AI_PROVIDER=cursor', async () => {
    process.env.FLOWX_BRIEFING_AI_PROVIDER = 'cursor';

    const summary = await createService().summarize({
      date: '2026-06-03',
      projectName: 'FlowX',
      events: [pushEvent()],
    });

    expect(summary.source).toBe('ai');
    expect(summary.aiProvider).toBe('cursor');
    expect(cursorRunStructuredJsonStage).toHaveBeenCalled();
    expect(codexRunStructuredJsonStage).not.toHaveBeenCalled();
    expect(resolveInvocationContext).toHaveBeenCalledWith('cursor', null);
  });

  it('falls back to a conservative summary when AI is disabled', async () => {
    process.env.FLOWX_BRIEFING_AI_DISABLED = 'true';

    const summary = await createService().summarize({
      date: '2026-06-03',
      projectName: 'FlowX',
      events: [
        pushEvent(),
      ],
    });

    expect(summary.source).toBe('fallback');
    expect(codexRunStructuredJsonStage).not.toHaveBeenCalled();
    expect(cursorRunStructuredJsonStage).not.toHaveBeenCalled();
    expect(summary.topics).toEqual([]);
    expect(summary.openQuestions).toEqual([]);
  });

  it('rejects the whole AI summary when it references a missing commit', async () => {
    codexRunStructuredJsonStage.mockResolvedValue({
      ...aiOutput,
      topics: [
        {
          ...aiOutput.topics[0],
          commitReferences: [{ repository: 'flowx-api', commitId: 'missing' }],
        },
      ],
    });

    const summary = await createService().summarize({
      date: '2026-06-03',
      projectName: 'FlowX',
      events: [pushEvent()],
    });

    expect(summary.source).toBe('fallback');
    expect(summary.topics).toEqual([]);
    expect(summary.openQuestions).toEqual([]);
  });

  it('rejects the whole AI summary when topics reuse the same commit', async () => {
    codexRunStructuredJsonStage.mockResolvedValue({
      ...aiOutput,
      topics: [
        aiOutput.topics[0],
        {
          ...aiOutput.topics[0],
          title: '重复主题',
        },
      ],
    });

    const summary = await createService().summarize({
      date: '2026-06-03',
      projectName: 'FlowX',
      events: [pushEvent()],
    });

    expect(summary.source).toBe('fallback');
    expect(summary.topics).toEqual([]);
  });
});
