import { describe, expect, it, vi } from 'vitest';
import { reserveWorkItemDisplayCode, workItemKindPrefix } from './work-item-identifier.service';

describe('工作项可读编号', () => {
  it('按类型使用固定前缀并补齐三位序号', async () => {
    const upsert = vi.fn()
      .mockResolvedValueOnce({ nextValue: 1 })
      .mockResolvedValueOnce({ nextValue: 12 });
    const tx = { workItemSequence: { upsert } };

    await expect(reserveWorkItemDisplayCode(tx, 'project-1', 'REQUIREMENT')).resolves.toBe('REQ-001');
    await expect(reserveWorkItemDisplayCode(tx, 'project-1', 'ISSUE')).resolves.toBe('ISSUE-012');
    expect(upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { projectId_kind: { projectId: 'project-1', kind: 'REQUIREMENT' } },
      create: { projectId: 'project-1', kind: 'REQUIREMENT', nextValue: 1 },
      update: { nextValue: { increment: 1 } },
    }));
  });

  it('未知类型也能保持可读前缀', () => {
    expect(workItemKindPrefix('CUSTOM')).toBe('CUSTOM');
    expect(workItemKindPrefix('BUG')).toBe('BUG');
  });

  it('同一项目按类型递增，不同项目从 001 重新开始', async () => {
    const values = new Map<string, number>();
    const tx = {
      workItemSequence: {
        upsert: vi.fn(async (args: { where: { projectId_kind: { projectId: string; kind: string } } }) => {
          const key = `${args.where.projectId_kind.projectId}:${args.where.projectId_kind.kind}`;
          const nextValue = (values.get(key) ?? 0) + 1;
          values.set(key, nextValue);
          return { nextValue };
        }),
      },
    };

    await expect(reserveWorkItemDisplayCode(tx, 'project-1', 'REQUIREMENT')).resolves.toBe('REQ-001');
    await expect(reserveWorkItemDisplayCode(tx, 'project-1', 'REQUIREMENT')).resolves.toBe('REQ-002');
    await expect(reserveWorkItemDisplayCode(tx, 'project-1', 'BUG')).resolves.toBe('BUG-001');
    await expect(reserveWorkItemDisplayCode(tx, 'project-2', 'REQUIREMENT')).resolves.toBe('REQ-001');
  });
});
