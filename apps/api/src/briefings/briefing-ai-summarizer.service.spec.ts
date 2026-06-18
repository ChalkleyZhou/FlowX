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
  const originalBriefingTimeout = process.env.FLOWX_BRIEFING_AI_TIMEOUT_MS;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FLOWX_BRIEFING_AI_DISABLED;
    delete process.env.FLOWX_BRIEFING_AI_PROVIDER;
    delete process.env.FLOWX_BRIEFING_AI_TIMEOUT_MS;
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
    if (originalBriefingTimeout === undefined) {
      delete process.env.FLOWX_BRIEFING_AI_TIMEOUT_MS;
    } else {
      process.env.FLOWX_BRIEFING_AI_TIMEOUT_MS = originalBriefingTimeout;
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
      period: 'DAILY',
      date: '2026-06-03',
      rangeLabel: '2026-06-03',
      projectName: 'FlowX',
      events: [pushEvent()],
    });

    expect(summary.source).toBe('ai');
    expect(summary.aiProvider).toBe('codex');
    expect(codexRunStructuredJsonStage).toHaveBeenCalled();
    expect(codexRunStructuredJsonStage.mock.calls[0]?.[1]).toContain('周期：DAILY');
    expect(codexRunStructuredJsonStage.mock.calls[0]?.[1]).toContain('范围：2026-06-03');
    expect(codexRunStructuredJsonStage.mock.calls[0]?.[1]).toContain('一个周期的 commit');
    expect(cursorRunStructuredJsonStage).not.toHaveBeenCalled();
    expect(resolveInvocationContext).toHaveBeenCalledWith('codex', null);
    expect(codexRunStructuredJsonStage.mock.calls[0]?.[4]).toEqual({ timeoutMs: 180_000 });
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
      period: 'DAILY',
      date: '2026-06-03',
      rangeLabel: '2026-06-03',
      projectName: 'FlowX',
      events: [pushEvent()],
    });

    expect(summary.source).toBe('ai');
    expect(summary.aiProvider).toBe('cursor');
    expect(cursorRunStructuredJsonStage).toHaveBeenCalled();
    expect(codexRunStructuredJsonStage).not.toHaveBeenCalled();
    expect(resolveInvocationContext).toHaveBeenCalledWith('cursor', null);
  });

  it('allows overriding the briefing AI timeout', async () => {
    process.env.FLOWX_BRIEFING_AI_TIMEOUT_MS = '3500';

    await createService().summarize({
      period: 'DAILY',
      date: '2026-06-03',
      rangeLabel: '2026-06-03',
      projectName: 'FlowX',
      events: [pushEvent()],
    });

    expect(codexRunStructuredJsonStage.mock.calls[0]?.[4]).toEqual({ timeoutMs: 3500 });
  });

  it('falls back to a conservative summary when AI is disabled', async () => {
    process.env.FLOWX_BRIEFING_AI_DISABLED = 'true';

    const summary = await createService().summarize({
      period: 'DAILY',
      date: '2026-06-03',
      rangeLabel: '2026-06-03',
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

  it('uses weekly fallback copy when a weekly briefing has no commits', async () => {
    const summary = await createService().summarize({
      period: 'WEEKLY',
      date: '2026-06-15',
      rangeLabel: '2026-06-15 至 2026-06-21',
      projectName: 'FlowX',
      events: [],
    });

    expect(summary).toMatchObject({
      source: 'fallback',
      headline: '',
      summaryParagraph: '本周暂无可归纳的项目变化。',
      topics: [],
      openQuestions: [],
    });
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
      period: 'DAILY',
      date: '2026-06-03',
      rangeLabel: '2026-06-03',
      projectName: 'FlowX',
      events: [pushEvent()],
    });

    expect(summary.source).toBe('fallback');
    expect(summary.topics).toEqual([]);
    expect(summary.openQuestions).toEqual([]);
  });

  it('deduplicates reused commits and keeps the first topic', async () => {
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
      period: 'DAILY',
      date: '2026-06-03',
      rangeLabel: '2026-06-03',
      projectName: 'FlowX',
      events: [pushEvent()],
    });

    expect(summary.source).toBe('ai');
    expect(summary.topics).toHaveLength(1);
    expect(summary.topics[0]?.title).toBe('简报内容组织调整');
  });

  it('keeps later topics when only duplicate commits are removed', async () => {
    codexRunStructuredJsonStage.mockResolvedValue({
      ...aiOutput,
      topics: [
        aiOutput.topics[0],
        {
          title: '第二个主题',
          summary: '引用另一条提交。',
          modules: ['briefing'],
          commitReferences: [
            { repository: 'flowx-api', commitId: 'a1' },
            { repository: 'flowx-api', commitId: 'b2' },
          ],
        },
      ],
    });

    const summary = await createService().summarize({
      period: 'DAILY',
      date: '2026-06-03',
      rangeLabel: '2026-06-03',
      projectName: 'FlowX',
      events: [
        pushEvent(),
        pushEvent({
          commits: [{ id: 'b2', message: 'fix(briefing): dedupe topics' }],
        }),
      ],
    });

    expect(summary.source).toBe('ai');
    expect(summary.topics).toHaveLength(2);
    expect(summary.topics[1]?.title).toBe('第二个主题');
    expect(summary.topics[1]?.commitReferences).toEqual([
      {
        repository: 'flowx-api',
        commitId: 'b2',
        title: 'fix(briefing): dedupe topics',
      },
    ]);
  });

  it('skips malformed topics missing commitReferences instead of failing the summary', async () => {
    codexRunStructuredJsonStage.mockResolvedValue({
      ...aiOutput,
      topics: [
        aiOutput.topics[0],
        {
          title: '缺少引用',
          summary: '没有 commitReferences 字段。',
          modules: [],
        },
      ],
    });

    const summary = await createService().summarize({
      period: 'DAILY',
      date: '2026-06-03',
      rangeLabel: '2026-06-03',
      projectName: 'FlowX',
      events: [pushEvent()],
    });

    expect(summary.source).toBe('ai');
    expect(summary.topics).toHaveLength(1);
    expect(summary.topics[0]?.title).toBe('简报内容组织调整');
  });

  it('tolerates missing headline and modules fields from AI output', async () => {
    codexRunStructuredJsonStage.mockResolvedValue({
      headline: undefined,
      summaryParagraph: '当天提交主要调整了简报内容组织。',
      topics: [
        {
          title: '简报内容组织调整',
          summary: '简报从提交分类调整为项目变化主题。',
          commitReferences: [{ repository: 'flowx-api', commitId: 'a1' }],
        },
      ],
      openQuestions: undefined,
    });

    const summary = await createService().summarize({
      period: 'DAILY',
      date: '2026-06-03',
      rangeLabel: '2026-06-03',
      projectName: 'FlowX',
      events: [pushEvent()],
    });

    expect(summary.source).toBe('ai');
    expect(summary.headline).toBe('');
    expect(summary.openQuestions).toEqual([]);
    expect(summary.topics[0]?.modules).toEqual([]);
  });
});
