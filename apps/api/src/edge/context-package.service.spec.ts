import { FLOWX_PROTOCOL_VERSION } from '@flowx-ai/protocol';
import { describe, expect, it, vi } from 'vitest';
import { ContextPackageService } from './context-package.service';

describe('ContextPackageService', () => {
  it('returns a versioned shared context package for Cursor and Codex', async () => {
    const prisma = {
      requirement: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'req-1',
          title: 'Export CSV',
          description: 'Users need exports',
          acceptanceCriteria: 'CSV has headers',
          requirementRepositories: [
            {
              repository: {
                id: 'repo-1',
                name: 'flowx-web',
                url: 'https://example.com/flowx-web.git',
                defaultBranch: 'main',
              },
            },
          ],
        }),
      },
      bug: { findUniqueOrThrow: vi.fn() },
    };
    const service = new ContextPackageService(prisma as never);

    const cursor = await service.getContextPackage('requirement', 'req-1', 'cursor');
    const codex = await service.getContextPackage('requirement', 'req-1', 'codex');

    expect(cursor.protocolVersion).toBe(FLOWX_PROTOCOL_VERSION);
    expect(cursor.task).toEqual(codex.task);
    expect(cursor.repositories).toEqual(codex.repositories);
    expect(cursor.sourceTool).toBe('cursor');
    expect(codex.sourceTool).toBe('codex');
  });

  it('includes filled requirement profile fields in the shared context', async () => {
    const prisma = {
      requirement: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'req-1',
          title: 'Export CSV',
          description: 'Users need exports',
          acceptanceCriteria: 'CSV has headers',
          priority: 'HIGH',
          functionalModule: '导出',
          riskImpact: ' ',
          productRequirementDocument: '见 PRD',
          remark: '先做 CSV',
          createdByName: 'Ada',
          requirementRepositories: [],
        }),
      },
      bug: { findUniqueOrThrow: vi.fn() },
    };
    const service = new ContextPackageService(prisma as never);

    const context = await service.getContextPackage('requirement', 'req-1', 'cursor');

    expect(context.task).toMatchObject({
      priority: 'HIGH',
      functionalModule: '导出',
      productRequirementDocument: '见 PRD',
      remark: '先做 CSV',
      createdByName: 'Ada',
    });
    expect(context.task).not.toHaveProperty('riskImpact');
  });

  it('keeps raw legacy context available to the compatibility API', async () => {
    const raw = { id: 'bug-1', title: 'Login fails' };
    const prisma = {
      requirement: { findUniqueOrThrow: vi.fn() },
      bug: { findUniqueOrThrow: vi.fn().mockResolvedValue(raw) },
    };
    const service = new ContextPackageService(prisma as never);

    await expect(service.getLegacyTaskContext('bug', 'bug-1')).resolves.toBe(raw);
  });
});
