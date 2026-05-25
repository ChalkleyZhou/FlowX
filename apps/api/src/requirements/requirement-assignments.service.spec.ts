import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequirementPlanningStatus } from '../common/enums';
import { RequirementAssignmentsService } from './requirement-assignments.service';

describe('RequirementAssignmentsService', () => {
  const requirementId = 'req-1';
  let prisma: {
    requirement: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
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
      requirement: {
        findUnique: vi.fn().mockResolvedValue({ id: requirementId, planningStatus: 'UNSCHEDULED' }),
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
      service.create(requirementId, {
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
      requirementId,
      userId: 'user-1',
      role: 'FRONTEND',
      plannedStartDate: new Date('2026-05-18T00:00:00.000Z'),
      plannedEndDate: new Date('2026-05-22T00:00:00.000Z'),
      sortOrder: 0,
      colorToken: null,
      note: null,
      user: { id: 'user-1', displayName: 'Alice', avatarUrl: null },
    });

    await service.create(requirementId, {
      userId: 'user-1',
      role: 'FRONTEND',
      plannedStartDate: '2026-05-18',
      plannedEndDate: '2026-05-22',
    });

    expect(prisma.requirement.update).toHaveBeenCalledWith({
      where: { id: requirementId },
      data: { planningStatus: RequirementPlanningStatus.SCHEDULED },
    });
  });

  it('marks requirement unscheduled after last assignment removed', async () => {
    prisma.requirementAssignment.findFirst.mockResolvedValue({ id: 'a1', requirementId });
    prisma.requirementAssignment.count.mockResolvedValue(0);

    await service.remove(requirementId, 'a1');

    expect(prisma.requirement.update).toHaveBeenCalledWith({
      where: { id: requirementId },
      data: { planningStatus: RequirementPlanningStatus.UNSCHEDULED },
    });
  });

  it('maps duplicate user conflict', async () => {
    prisma.requirementAssignment.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.create(requirementId, {
        userId: 'user-1',
        role: 'FRONTEND',
        plannedStartDate: '2026-05-18',
        plannedEndDate: '2026-05-22',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
