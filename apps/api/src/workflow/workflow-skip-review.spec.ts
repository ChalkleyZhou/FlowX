import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { WorkflowService } from './workflow.service';

function createSkipReviewService(stageStatus = 'FAILED') {
  const workflow = {
    id: 'workflow-1',
    status: 'REVIEW_PENDING',
    runType: 'FULL',
    requirement: { title: '需求' },
    stageExecutions: [{ id: 'stage-1', stage: 'AI_REVIEW', attempt: 1, status: stageStatus }],
  };
  const tx = {
    stageExecution: {
      findFirst: vi.fn().mockResolvedValue(workflow.stageExecutions[0]),
      findUniqueOrThrow: vi.fn().mockResolvedValue(workflow.stageExecutions[0]),
      update: vi.fn().mockResolvedValue(undefined),
    },
    reviewReport: { upsert: vi.fn().mockResolvedValue(undefined) },
    workflowRun: {
      update: vi.fn().mockResolvedValue(undefined),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...workflow, status: 'HUMAN_REVIEW_PENDING' }),
    },
  };
  const prisma = {
    workflowRun: { findUniqueOrThrow: vi.fn().mockResolvedValue(workflow) },
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const service = new WorkflowService(
    prisma as never,
    new WorkflowStateMachine(),
    {} as never,
    { notifyStageCompleted: vi.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, tx };
}

describe('WorkflowService.skipReview', () => {
  it('marks a failed AI review as skipped and enters human review', async () => {
    const { service, tx } = createSkipReviewService();

    const result = await service.skipReview('workflow-1');

    expect(result.status).toBe('HUMAN_REVIEW_PENDING');
    expect(tx.stageExecution.update).toHaveBeenCalledWith({
      where: { id: 'stage-1' },
      data: expect.objectContaining({ status: 'SKIPPED', statusMessage: '已跳过 AI 审查，等待人工审核' }),
    });
    expect(tx.reviewReport.upsert).toHaveBeenCalledWith({
      where: { workflowRunId: 'workflow-1' },
      create: expect.objectContaining({ status: 'WAITING_HUMAN_REVIEW', issues: [], bugs: [] }),
      update: expect.objectContaining({ status: 'WAITING_HUMAN_REVIEW', issues: [], bugs: [] }),
    });
  });

  it('rejects skipping while AI review is running', async () => {
    const { service } = createSkipReviewService('RUNNING');

    await expect(service.skipReview('workflow-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
