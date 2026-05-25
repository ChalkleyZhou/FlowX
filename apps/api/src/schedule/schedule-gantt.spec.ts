import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleService } from './schedule.service';

describe('ScheduleService.buildGanttPayload', () => {
  let prisma: {
    project: { findUnique: ReturnType<typeof vi.fn> };
    requirementAssignment: { findMany: ReturnType<typeof vi.fn> };
  };
  let service: ScheduleService;

  beforeEach(() => {
    prisma = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'proj-1' }) },
      requirementAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    };
    service = new ScheduleService(prisma as never);
  });

  it('builds requirement view lanes and bars', async () => {
    prisma.requirementAssignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        requirementId: 'req-1',
        userId: 'u1',
        role: 'FRONTEND',
        plannedStartDate: new Date('2026-05-18T00:00:00.000Z'),
        plannedEndDate: new Date('2026-05-20T00:00:00.000Z'),
        colorToken: null,
        user: { displayName: 'Alice' },
        requirement: {
          title: '登录优化',
          projectId: 'proj-1',
          project: { id: 'proj-1', name: 'FlowX' },
        },
      },
    ]);

    const payload = await service.buildGanttPayload({
      view: 'requirement',
      projectId: 'proj-1',
      from: '2026-05-01',
      to: '2026-05-31',
    });

    expect(payload.lanes).toEqual([
      expect.objectContaining({ id: 'req:req-1', kind: 'requirement', label: '登录优化' }),
    ]);
    expect(payload.bars).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'a1', laneId: 'req:req-1', start: '2026-05-18', end: '2026-05-20' }),
        expect.objectContaining({ id: 'req:req-1:aggregate' }),
      ]),
    );
  });

  it('builds member view with user lanes', async () => {
    prisma.requirementAssignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        requirementId: 'req-1',
        userId: 'u1',
        role: 'BACKEND',
        plannedStartDate: new Date('2026-05-18T00:00:00.000Z'),
        plannedEndDate: new Date('2026-05-19T00:00:00.000Z'),
        colorToken: null,
        user: { displayName: 'Bob' },
        requirement: {
          title: 'API 限流',
          projectId: 'proj-1',
          project: { id: 'proj-1', name: 'FlowX' },
        },
      },
    ]);

    const payload = await service.buildGanttPayload({
      view: 'member',
      projectId: 'proj-1',
      from: '2026-05-01',
      to: '2026-05-31',
    });

    expect(payload.lanes[0]).toMatchObject({ id: 'user:u1', kind: 'member', label: 'Bob' });
    expect(payload.bars[0]).toMatchObject({
      laneId: 'user:u1',
      label: 'API 限流 · BACKEND',
    });
  });

  it('filters bars outside viewport', async () => {
    prisma.requirementAssignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        requirementId: 'req-1',
        userId: 'u1',
        role: 'QA',
        plannedStartDate: new Date('2026-06-01T00:00:00.000Z'),
        plannedEndDate: new Date('2026-06-05T00:00:00.000Z'),
        colorToken: null,
        user: { displayName: 'Alice' },
        requirement: {
          title: '六月需求',
          projectId: 'proj-1',
          project: { id: 'proj-1', name: 'FlowX' },
        },
      },
    ]);

    const payload = await service.buildGanttPayload({
      view: 'member',
      projectId: 'proj-1',
      from: '2026-05-01',
      to: '2026-05-31',
    });

    expect(payload.bars).toHaveLength(0);
  });

  it('builds organization member view across projects', async () => {
    prisma.requirementAssignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        requirementId: 'req-1',
        userId: 'u1',
        role: 'FRONTEND',
        plannedStartDate: new Date('2026-05-18T00:00:00.000Z'),
        plannedEndDate: new Date('2026-05-20T00:00:00.000Z'),
        colorToken: null,
        user: { displayName: 'Alice' },
        requirement: {
          title: '登录优化',
          projectId: 'proj-a',
          project: { id: 'proj-a', name: '产品 A' },
        },
      },
      {
        id: 'a2',
        requirementId: 'req-2',
        userId: 'u1',
        role: 'BACKEND',
        plannedStartDate: new Date('2026-05-22T00:00:00.000Z'),
        plannedEndDate: new Date('2026-05-24T00:00:00.000Z'),
        colorToken: null,
        user: { displayName: 'Alice' },
        requirement: {
          title: '支付接口',
          projectId: 'proj-b',
          project: { id: 'proj-b', name: '产品 B' },
        },
      },
    ]);

    const payload = await service.buildGanttPayload({
      view: 'member',
      scope: 'organization',
      organizationId: 'org-1',
      from: '2026-05-01',
      to: '2026-05-31',
    });

    expect(prisma.project.findUnique).not.toHaveBeenCalled();
    expect(payload.lanes).toEqual([
      expect.objectContaining({ id: 'user:u1', kind: 'member', label: 'Alice' }),
    ]);
    expect(payload.bars).toHaveLength(2);
    expect(payload.bars[0].label).toBe('产品 A · 登录优化 · FRONTEND');
    expect(payload.bars[1].label).toBe('产品 B · 支付接口 · BACKEND');
  });

  it('builds organization requirement view with project prefix on lanes', async () => {
    prisma.requirementAssignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        requirementId: 'req-1',
        userId: 'u1',
        role: 'FRONTEND',
        plannedStartDate: new Date('2026-05-18T00:00:00.000Z'),
        plannedEndDate: new Date('2026-05-20T00:00:00.000Z'),
        colorToken: null,
        user: { displayName: 'Alice' },
        requirement: {
          title: '登录优化',
          projectId: 'proj-a',
          project: { id: 'proj-a', name: '产品 A' },
        },
      },
    ]);

    const payload = await service.buildGanttPayload({
      view: 'requirement',
      scope: 'organization',
      organizationId: 'org-1',
      from: '2026-05-01',
      to: '2026-05-31',
    });

    expect(payload.lanes[0].label).toBe('产品 A · 登录优化');
  });

  it('filters organization scope by projectId', async () => {
    prisma.requirementAssignment.findMany.mockResolvedValue([]);

    await service.buildGanttPayload({
      view: 'member',
      scope: 'organization',
      organizationId: 'org-1',
      projectId: 'proj-a',
      from: '2026-05-01',
      to: '2026-05-31',
    });

    expect(prisma.requirementAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          requirement: { projectId: 'proj-a' },
        }),
      }),
    );
  });

  it('filters by assignment role', async () => {
    prisma.requirementAssignment.findMany.mockResolvedValue([]);

    await service.buildGanttPayload({
      view: 'member',
      scope: 'organization',
      organizationId: 'org-1',
      role: 'FRONTEND',
      from: '2026-05-01',
      to: '2026-05-31',
    });

    expect(prisma.requirementAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: 'FRONTEND' }),
      }),
    );
  });

  it('loads organization scope without organizationId (all assignments)', async () => {
    prisma.requirementAssignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        requirementId: 'req-1',
        userId: 'u1',
        role: 'QA',
        plannedStartDate: new Date('2026-05-18T00:00:00.000Z'),
        plannedEndDate: new Date('2026-05-20T00:00:00.000Z'),
        colorToken: null,
        user: { displayName: 'Carol' },
        requirement: {
          title: '测试',
          projectId: 'proj-1',
          project: { id: 'proj-1', name: 'FlowX' },
        },
      },
    ]);

    const payload = await service.buildGanttPayload({
      view: 'member',
      scope: 'organization',
      from: '2026-05-01',
      to: '2026-05-31',
    });

    expect(prisma.requirementAssignment.findMany).toHaveBeenCalled();
    expect(payload.bars).toHaveLength(1);
    expect(payload.bars[0].start).toBe('2026-05-18');
  });

  it('supports requirementId filter on organization scope', async () => {
    prisma.requirementAssignment.findMany.mockResolvedValue([]);

    await service.buildGanttPayload({
      view: 'member',
      scope: 'organization',
      requirementId: 'req-1',
      from: '2026-05-01',
      to: '2026-05-31',
    });

    expect(prisma.requirementAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          requirement: { id: 'req-1' },
        }),
      }),
    );
  });
});
