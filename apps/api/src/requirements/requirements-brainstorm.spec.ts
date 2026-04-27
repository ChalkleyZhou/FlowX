import { describe, expect, it } from 'vitest';
import { RequirementsService } from './requirements.service';

describe('RequirementsService brainstorm output normalization', () => {
  const createService = () =>
    new RequirementsService({} as any, {} as any, {} as any, {} as any, {} as any);

  it('accepts wrapped brainstorm output with brief field', () => {
    const service = createService();

    const normalized = (service as any).normalizeBrainstormOutput({
      brief: {
        expandedDescription: 'Expanded',
        userStories: [{ role: 'user', action: 'do', benefit: 'value' }],
        edgeCases: [],
        successMetrics: [],
        openQuestions: [],
        assumptions: [],
        outOfScope: [],
      },
    });

    expect(normalized.brief.expandedDescription).toBe('Expanded');
  });

  it('accepts flat brainstorm output without brief wrapper', () => {
    const service = createService();

    const normalized = (service as any).normalizeBrainstormOutput({
      expandedDescription: 'Expanded',
      userStories: [{ role: 'user', action: 'do', benefit: 'value' }],
      edgeCases: [],
      successMetrics: [],
      openQuestions: [],
      assumptions: [],
      outOfScope: [],
    });

    expect(normalized.brief.expandedDescription).toBe('Expanded');
  });
});
