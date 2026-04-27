import { describe, expect, it, vi } from 'vitest';
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

describe('RequirementsService confirmBrainstorm session selection', () => {
  it('confirms latest waiting session with valid brief when newest attempt failed', async () => {
    const prisma = {
      ideationArtifact: { create: vi.fn().mockResolvedValue({}) },
      ideationSession: { update: vi.fn().mockResolvedValue({}) },
      requirement: { update: vi.fn().mockResolvedValue({}) },
    } as any;
    const service = new RequirementsService(prisma, {} as any, {} as any, {} as any, {} as any);

    vi.spyOn(service, 'findOne').mockResolvedValue({
      id: 'req-1',
      ideationStatus: 'BRAINSTORM_WAITING_CONFIRMATION',
      ideationSessions: [
        {
          id: 'session-ok',
          stage: 'BRAINSTORM',
          attempt: 1,
          status: 'WAITING_CONFIRMATION',
          output: {
            brief: {
              expandedDescription: 'ready',
              userStories: [{ role: 'r', action: 'a', benefit: 'b' }],
              edgeCases: [],
              successMetrics: [],
              openQuestions: [],
              assumptions: [],
              outOfScope: [],
            },
          },
        },
        {
          id: 'session-failed',
          stage: 'BRAINSTORM',
          attempt: 2,
          status: 'FAILED',
          output: null,
        },
      ],
    } as any);
    vi.spyOn(service as any, 'markSupersededWaitingSessions').mockResolvedValue(undefined);

    await service.confirmBrainstorm('req-1');

    expect(prisma.ideationArtifact.create).toHaveBeenCalled();
    expect(prisma.ideationSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'session-ok' } }),
    );
  });
});
