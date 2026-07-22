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

    expect(cursor.protocolVersion).toBe('1.0');
    expect(cursor.task).toEqual(codex.task);
    expect(cursor.repositories).toEqual(codex.repositories);
    expect(cursor.sourceTool).toBe('cursor');
    expect(codex.sourceTool).toBe('codex');
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
