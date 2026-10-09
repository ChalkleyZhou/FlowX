import { describe, expect, it, vi } from 'vitest';
import { WorkflowController } from './workflow.controller';

describe('WorkflowController AI review', () => {
  it('keeps review requests without a body compatible with existing clients', () => {
    const runReview = vi.fn();
    const controller = new WorkflowController({ runReview } as never, {} as never);

    controller.runReview('run-1', undefined as never, { authSession: undefined } as never);

    expect(runReview).toHaveBeenCalledWith('run-1', undefined, undefined, undefined);
  });

  it('passes the selected provider to the review service', () => {
    const runReview = vi.fn();
    const controller = new WorkflowController({ runReview } as never, {} as never);

    controller.runReview('run-1', { aiProvider: 'codex' }, { authSession: undefined } as never);

    expect(runReview).toHaveBeenCalledWith('run-1', undefined, undefined, 'codex');
  });
});
