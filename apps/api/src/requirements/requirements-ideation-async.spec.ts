import { describe, expect, it, vi } from 'vitest';
import { RequirementsService } from './requirements.service';

function setup() {
  const prisma = {
    ideationSession: {
      create: vi.fn().mockResolvedValue({ id: 'session-1' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    requirement: { update: vi.fn().mockResolvedValue({}) },
  };
  const executor = { brainstorm: vi.fn(), generateDesign: vi.fn() };
  const service = new RequirementsService(
    prisma as never,
    { get: () => executor } as never,
    { normalizeAiProvider: () => 'codex', resolveInvocationContext: vi.fn().mockResolvedValue({}) } as never,
    {} as never, {} as never, {} as never,
  );
  vi.spyOn(service, 'findOne').mockResolvedValue({
    id: 'req-1', title: '登录', description: '支持登录', ideationStatus: 'NONE', ideationSessions: [],
  } as never);
  return { service, prisma, executor };
}

describe('RequirementsService asynchronous ideation', () => {
  it('returns a running brainstorm session before AI finishes', async () => {
    const { service, prisma, executor } = setup();
    vi.spyOn(service as never, 'getPreviousBriefs' as never).mockResolvedValue([] as never);
    let complete!: (value: unknown) => void;
    executor.brainstorm.mockReturnValue(new Promise((resolve) => { complete = resolve; }));

    await expect(service.startBrainstorm('req-1')).resolves.toMatchObject({ id: 'req-1' });
    expect(executor.brainstorm).not.toHaveBeenCalled();
    expect(prisma.requirement.update).toHaveBeenCalledWith({
      where: { id: 'req-1' }, data: { ideationStatus: 'BRAINSTORM_PENDING' },
    });
    await vi.waitFor(() => expect(executor.brainstorm).toHaveBeenCalledOnce());
    complete({ brief: { expandedDescription: '登录流程' } });
    await vi.waitFor(() => expect(prisma.ideationSession.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'WAITING_CONFIRMATION' }),
    })));
  });

  it('records an asynchronous brainstorm failure and restores the previous status', async () => {
    const { service, prisma, executor } = setup();
    vi.spyOn(service as never, 'getPreviousBriefs' as never).mockResolvedValue([] as never);
    executor.brainstorm.mockRejectedValue(new Error('provider unavailable'));

    await service.startBrainstorm('req-1');
    await vi.waitFor(() => expect(prisma.ideationSession.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', errorMessage: 'provider unavailable' }),
    })));
    expect(prisma.requirement.update).toHaveBeenLastCalledWith({
      where: { id: 'req-1' }, data: { ideationStatus: 'NONE' },
    });
  });
});
