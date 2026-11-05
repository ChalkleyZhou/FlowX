import { describe, expect, it, vi } from 'vitest';
import { ReviewArtifactsService } from './review-artifacts.service';

describe('ReviewArtifactsService.convertReviewFindingToBug', () => {
  it('把需求所属项目写到转出的缺陷上', async () => {
    const prisma = {
      reviewFinding: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'finding-1',
          convertedBugId: null,
          convertedIssueId: null,
          workflowRunId: 'run-1',
          severity: 'HIGH',
          title: '登录失败',
          description: '无法进入首页',
          metadata: null,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      workflowRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'run-1',
          requirementId: 'req-1',
          requirement: { workspaceId: 'workspace-1', projectId: 'project-1' },
        }),
      },
      bug: {
        create: vi.fn().mockResolvedValue({ id: 'bug-1' }),
      },
    };
    const service = new ReviewArtifactsService(prisma as never, {} as never);

    await service.convertReviewFindingToBug('finding-1', {}, 'user-1');

    expect(prisma.bug.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        requirementId: 'req-1',
        workflowRunId: 'run-1',
      }),
    }));
  });
});
