import { FLOWX_PROTOCOL_VERSION } from '@flowx-ai/protocol';
import { describe, expect, it, vi } from 'vitest';
import { ContextPackageService } from './context-package.service';

function createService(workItem: Record<string, unknown>) {
  const prisma = {
    executionItem: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'exec-1', title: 'Export CSV implementation', description: 'Implement export',
        executionPlan: { workItem: { kind: 'REQUIREMENT', requirementRepositories: [], repository: null, ...workItem } },
      }),
    },
  };
  return new ContextPackageService(prisma as never);
}

describe('ContextPackageService', () => {
  it('returns a versioned shared context package for Cursor and Codex', async () => {
    const service = createService({ id: 'work-1', title: 'Export CSV', description: 'Users need exports', acceptanceCriteria: 'CSV has headers', requirementRepositories: [{ repository: { id: 'repo-1', name: 'flowx-web', url: 'https://example.com/flowx-web.git', defaultBranch: 'main' } }] });
    const cursor = await service.getContextPackage('exec-1', 'cursor');
    const codex = await service.getContextPackage('exec-1', 'codex');
    expect(cursor.protocolVersion).toBe(FLOWX_PROTOCOL_VERSION);
    expect(cursor.task).toEqual(codex.task);
    expect(cursor.repositories).toEqual(codex.repositories);
    expect(cursor.sourceTool).toBe('cursor');
  });

  it('includes filled work item profile fields in the shared context', async () => {
    const service = createService({ id: 'work-1', title: 'Export CSV', description: 'Users need exports', acceptanceCriteria: 'CSV has headers', priority: 'HIGH', functionalModule: '导出', riskImpact: ' ', productRequirementDocument: '见 PRD', remark: '先做 CSV', createdByName: 'Ada' });
    const context = await service.getContextPackage('exec-1', 'cursor');
    expect(context.task).toMatchObject({ priority: 'HIGH', functionalModule: '导出', productRequirementDocument: '见 PRD', remark: '先做 CSV', createdByName: 'Ada' });
    expect(context.task).not.toHaveProperty('riskImpact');
  });
});

it('执行上下文和任务原始上下文返回标签摘要', async () => {
  const service = createService({ id: 'work-1', title: '标签', labels: [{ label: { id: 'label-1', name: '前端', color: 'BLUE' } }] });
  expect((await service.getContextPackage('exec-1', 'codex')).task.labels).toEqual([{ id: 'label-1', name: '前端', color: 'BLUE' }]);
  expect((await service.getTaskContext('exec-1')).executionPlan.workItem.labels).toEqual([{ id: 'label-1', name: '前端', color: 'BLUE' }]);
});
