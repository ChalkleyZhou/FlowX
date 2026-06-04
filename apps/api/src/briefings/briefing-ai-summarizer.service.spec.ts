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
  headline: '完成简报 AI 总结',
  summaryParagraph: '新增 AI 归纳能力，并保留提交附录。',
  features: [
    {
      title: '简报 AI 总结',
      detail: '根据当日 webhook 事实生成管理层可读摘要。',
      repositories: ['flowx-api'],
    },
  ],
  fixes: [],
  risks: [],
  otherNotes: [],
};

describe('BriefingAiSummarizerService', () => {
  const codexRunStructuredJsonStage = vi.fn();
  const cursorRunStructuredJsonStage = vi.fn();
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
      { runStructuredJsonStage: codexRunStructuredJsonStage } as never,
      { runStructuredJsonStage: cursorRunStructuredJsonStage } as never,
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

  it('falls back to rule-based summary when AI is disabled', async () => {
    process.env.FLOWX_BRIEFING_AI_DISABLED = 'true';

    const summary = await createService().summarize({
      date: '2026-06-03',
      projectName: 'FlowX',
      events: [
        pushEvent(),
        pushEvent({
          eventType: 'merge_request',
          objectKind: 'merge_request',
          action: 'merge',
          subject: 'Merge briefing AI',
          summary: { state: 'merged' },
        }),
      ],
    });

    expect(summary.source).toBe('fallback');
    expect(codexRunStructuredJsonStage).not.toHaveBeenCalled();
    expect(cursorRunStructuredJsonStage).not.toHaveBeenCalled();
    expect(summary.features.some((item) => item.title.includes('feat(briefing)'))).toBe(true);
  });
});
