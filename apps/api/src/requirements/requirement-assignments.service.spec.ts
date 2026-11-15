import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequirementPlanningStatus } from '../common/enums';
import { RequirementAssignmentsService } from './requirement-assignments.service';

describe('RequirementAssignmentsService', () => {
  const workItemId = 'req-1';
  let prisma: {
    workItem: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    requirementAssignment: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    user: { findUnique: ReturnType<typeof vi.fn> };
  };
  let service: RequirementAssignmentsService;

  beforeEach(() => {
    prisma = {
      workItem: {
        findUnique: vi.fn().mockResolvedValue({ id: workItemId, planningStatus: 'UNSCHEDULED' }),
        update: vi.fn().mockResolvedValue({}),
      },
      requirementAssignment: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'user-1', displayName: 'Alice', avatarUrl: null }),
      },
    };
    service = new RequirementAssignmentsService(prisma as never);
  });

  it('rejects end date before start date', async () => {
    await expect(
      service.create(workItemId, {
        userId: 'user-1',
        role: 'FRONTEND',
        plannedStartDate: '2026-05-22',
        plannedEndDate: '2026-05-18',
      }),
    ).rejects.toThrow('plannedEndDate');
  });

  it('marks requirement scheduled after create', async () => {
    prisma.requirementAssignment.create.mockResolvedValue({
      id: 'a1',
      workItemId,
      userId: 'user-1',
      role: 'FRONTEND',
      plannedStartDate: new Date('2026-05-18T00:00:00.000Z'),
      plannedEndDate: new Date('2026-05-22T00:00:00.000Z'),
      sortOrder: 0,
      colorToken: null,
      note: null,
      user: { id: 'user-1', displayName: 'Alice', avatarUrl: null },
    });

    await service.create(workItemId, {
      userId: 'user-1',
      role: 'FRONTEND',
      plannedStartDate: '2026-05-18',
      plannedEndDate: '2026-05-22',
    });

    expect(prisma.workItem.update).toHaveBeenCalledWith({
      where: { id: workItemId },
      data: { planningStatus: RequirementPlanningStatus.SCHEDULED },
    });
  });

  it('marks requirement unscheduled after last assignment removed', async () => {
    prisma.requirementAssignment.findFirst.mockResolvedValue({ id: 'a1', workItemId });
    prisma.requirementAssignment.count.mockResolvedValue(0);

    await service.remove(workItemId, 'a1');

    expect(prisma.workItem.update).toHaveBeenCalledWith({
      where: { id: workItemId },
      data: { planningStatus: RequirementPlanningStatus.UNSCHEDULED },
    });
  });

  it('allows multiple assignments for the same user on one requirement', async () => {
    prisma.requirementAssignment.create.mockResolvedValue({
      id: 'a2',
      workItemId,
      userId: 'user-1',
      role: 'QA',
      plannedStartDate: new Date('2026-06-01T00:00:00.000Z'),
      plannedEndDate: new Date('2026-06-05T00:00:00.000Z'),
      sortOrder: 1,
      colorToken: null,
      note: null,
      user: { id: 'user-1', displayName: 'Alice', avatarUrl: null },
    });

    const result = await service.create(workItemId, {
      userId: 'user-1',
      role: 'QA',
      plannedStartDate: '2026-06-01',
      plannedEndDate: '2026-06-05',
    });

    expect(result.id).toBe('a2');
    expect(prisma.requirementAssignment.create).toHaveBeenCalled();
  });
});
