import { describe, expect, it, vi } from 'vitest';
import { LocalTestRunsService } from './local-test-runs.service';

class RevisionService extends LocalTestRunsService {
  revisions(ids: string[], fix?: string) { return this.resolveQualityRevisions(ids, fix); }
}
describe('质量回归代码基线', () => {
  it('以同一真实仓库的修复交付替代原交付，保留未修改仓库', async () => {
    const prisma = { workflowRepository: { findMany: vi.fn().mockResolvedValue([
      { id: 'old-a', repositoryId: 'repo-a' }, { id: 'fix-a', repositoryId: 'repo-a' }, { id: 'old-b', repositoryId: 'repo-b' },
    ]) } };
    const service = new RevisionService(prisma as never, {} as never);
    vi.spyOn(service as never, 'resolveExpectedRevisions' as never)
      .mockResolvedValueOnce([{ workflowRepositoryId: 'old-a', branch: 'main', headSha: 'aaa' }, { workflowRepositoryId: 'old-b', branch: 'main', headSha: 'bbb' }] as never)
      .mockResolvedValueOnce([{ workflowRepositoryId: 'fix-a', branch: 'fix', headSha: 'ccc' }] as never);
    expect(await service.revisions(['original'], 'fix')).toEqual([
      { workflowRepositoryId: 'fix-a', branch: 'fix', headSha: 'ccc' }, { workflowRepositoryId: 'old-b', branch: 'main', headSha: 'bbb' },
    ]);
  });
  it('修复没有代码交付时拒绝，不静默回退到原版本', async () => {
    const service = new RevisionService({} as never, {} as never);
    vi.spyOn(service as never, 'resolveExpectedRevisions' as never).mockResolvedValueOnce([{ workflowRepositoryId: 'old', branch: 'main', headSha: 'aaa' }] as never).mockResolvedValueOnce([] as never);
    await expect(service.revisions(['original'], 'fix')).rejects.toMatchObject({ status: 400 });
  });
});
