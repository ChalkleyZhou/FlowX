import { describe, expect, it, vi } from 'vitest';
import type { DemoPage } from '../common/types';
import { RequirementsService } from './requirements.service';

describe('RequirementsService demo generation progress events', () => {
  it('emits expected stage events during successful startDemoGeneration', async () => {
    const prisma = {
      ideationSession: {
        create: vi.fn().mockResolvedValue({
          id: 'session-1',
          attempt: 1,
          startedAt: new Date('2026-04-23T00:00:00.000Z'),
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      requirement: {
        update: vi.fn().mockResolvedValue({}),
      },
    } as any;
    const executor = {
      generateDesign: vi.fn().mockResolvedValue({ design: { overview: 'ok' }, demoPages: [] }),
    } as any;
    const aiInvocationContextService = {
      resolveInvocationContext: vi.fn().mockResolvedValue({}),
    } as any;
    const localDevPreviewService = {
      restartAfterDesignWrite: vi.fn().mockResolvedValue(undefined),
    } as any;
    const eventsRepo = {
      append: vi.fn().mockResolvedValue({}),
      list: vi.fn(),
    } as any;
    const service = new RequirementsService(
      prisma,
      { codex: executor, cursor: executor, mock: executor },
      aiInvocationContextService,
      localDevPreviewService,
      eventsRepo,
      { syncRepository: vi.fn() } as any,
    );

    const requirement = {
      id: 'req-1',
      title: 'Demo requirement',
      description: 'Generate demo pages',
      ideationStatus: 'DESIGN_CONFIRMED',
      requirementRepositories: [
        {
          repository: {
            id: 'repo-1',
            name: 'web',
            url: 'git@github.com:example/web.git',
            defaultBranch: 'main',
            localPath: '/tmp/repo-1',
            syncStatus: 'READY',
          },
        },
      ],
      project: null,
      workspace: null,
    };
    const page: DemoPage = {
      route: '/flowx-demo/test',
      componentName: 'TestPage',
      componentCode: 'export function TestPage() {}',
      mockData: {},
      filePath: 'src/pages/TestPage.tsx',
    };

    vi.spyOn(service, 'findOne').mockResolvedValue(requirement as any);
    vi.spyOn(service as any, 'getConfirmedBrief').mockResolvedValue({ expandedDescription: 'brief' });
    vi.spyOn(service as any, 'getConfirmedDesign').mockResolvedValue({ overview: 'design' });
    vi.spyOn(service as any, 'getPreviousDemoPages').mockResolvedValue([]);
    vi.spyOn(service as any, 'resolveIdeationExecutor').mockReturnValue(executor);
    vi.spyOn(service as any, 'resolveReadyRepositories').mockReturnValue([]);
    vi.spyOn(service as any, 'buildRepositoryComponentContext').mockResolvedValue(null);
    vi.spyOn(service as any, 'assertDesignHasComponentContextWhenNeeded').mockImplementation(() => {});
    vi.spyOn(service as any, 'runWithTimeout').mockImplementation(async (promise: Promise<unknown>) => promise);
    vi.spyOn(service as any, 'normalizeDesignOutput').mockReturnValue({
      design: { overview: 'ok' },
      demoPages: [page],
    });
    vi.spyOn(service as any, 'writeDemoPagesToRepo').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'getFirstReadyRepositoryId').mockReturnValue('repo-1');
    vi.spyOn(service as any, 'markSupersededWaitingSessions').mockResolvedValue(undefined);

    await service.startDemoGeneration('req-1', 'focus dashboard');
    await vi.waitFor(() => {
      expect(eventsRepo.append.mock.calls.length).toBeGreaterThanOrEqual(9);
    });

    const stages = eventsRepo.append.mock.calls.map((call: [any]) => call[0].stage);
    expect(stages).toEqual([
      'QUEUE',
      'QUEUE',
      'CONTEXT_SCAN',
      'CONTEXT_SCAN',
      'MODEL_RUNNING',
      'JSON_PARSE',
      'WRITE_FILES',
      'PREVIEW_START',
      'FINALIZE',
    ]);
    expect(eventsRepo.append.mock.calls[0][0].eventType).toBe('STARTED');
    expect(eventsRepo.append.mock.calls.at(-1)[0].eventType).toBe('COMPLETED');
    expect(prisma.ideationSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1' },
        data: expect.objectContaining({
          statusMessage: expect.stringContaining('(0s)'),
        }),
      }),
    );
  });
});
