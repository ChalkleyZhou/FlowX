import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactsService } from './artifacts.service';
import { EvidenceService } from './evidence.service';
import { SyncEventsService } from '../execution-sessions/sync-events.service';
import { ExecutionSessionsService } from '../execution-sessions/execution-sessions.service';

function setup() {
  const model = () => ({ findMany: vi.fn().mockResolvedValue([{ id: 'record-21' }]), count: vi.fn().mockResolvedValue(45) });
  const prisma = { artifact: model(), evidence: model(), syncEvent: { ...model(), findFirst: vi.fn().mockResolvedValue(null) }, executionSession: { findUnique: vi.fn().mockResolvedValue({ id: 'session', organizationId: 'org' }) } };
  const sessions = { requireAccessibleSession: vi.fn().mockResolvedValue({ id: 'session' }) };
  return { prisma, sessions,
    artifacts: new ArtifactsService(prisma as never, sessions as never, {} as never),
    evidence: new EvidenceService(prisma as never, sessions as never),
    events: new SyncEventsService(prisma as never, sessions as never),
    execution: new ExecutionSessionsService(prisma as never),
  };
}

describe('产物、证据和事件浏览分页', () => {
  it.each(['artifacts', 'evidence', 'events'] as const)('%s 在数据库分页并返回真实总数，先检查会话权限', async kind => {
    const services = setup();
    const query = { page: 2, pageSize: 20, q: '报告' };
    const result = kind === 'artifacts' ? await services.artifacts.listPage({ executionSessionId: 'session', ...query }, { organizationId: 'org' }) : await services[kind].listPage('session', query, { organizationId: 'org' });
    expect(result).toEqual({ items: [{ id: 'record-21' }], total: 45, page: 2, pageSize: 20, totalPages: 3 });
    const model = services.prisma[kind === 'artifacts' ? 'artifact' : kind === 'events' ? 'syncEvent' : 'evidence'];
    expect(model.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ executionSessionId: 'session' }), skip: 20, take: 20 }));
    expect(model.count).toHaveBeenCalledWith({ where: model.findMany.mock.calls[0][0].where });
    services.sessions.requireAccessibleSession.mockRejectedValue(new ForbiddenException());
    model.findMany.mockClear();
    const denied = kind === 'artifacts' ? services.artifacts.listPage({ executionSessionId: 'session' }) : services[kind].listPage('session');
    await expect(denied).rejects.toBeInstanceOf(ForbiddenException);
    expect(model.findMany).not.toHaveBeenCalled();
  });

  it('执行详情只加载子集合计数和最新进度，内部执行详情仍保留原契约', async () => {
    const { execution, prisma } = setup();
    await execution.findBrowse('session', { organizationId: 'org' });
    const browse = prisma.executionSession.findUnique.mock.calls[0][0];
    expect(browse.include).toMatchObject({ _count: { select: { syncEvents: true, artifacts: true, evidence: true } } });
    expect(browse.include).not.toHaveProperty('syncEvents');
    expect(browse.include).not.toHaveProperty('artifacts');
    expect(browse.include).not.toHaveProperty('evidence');
    await execution.findOne('session', { organizationId: 'org' });
    expect(prisma.executionSession.findUnique.mock.calls[1][0].include).toHaveProperty('artifacts');
  });
});
