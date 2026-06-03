import { describe, expect, it } from 'vitest';
import { buildLocalHandoff } from './workflow-local-handoff';

describe('buildLocalHandoff', () => {
  it('includes workingBranch and checkout commands', () => {
    const handoff = buildLocalHandoff({
      workflowRunId: 'cmworkflow12345678',
      status: 'EXECUTION_RUNNING',
      requirement: {
        id: 'req_1',
        title: 'Login welcome modal',
        description: 'desc',
        acceptanceCriteria: 'ac',
      },
      plan: {
        summary: 'Plan',
        implementationPlan: [],
        filesToModify: [],
        newFiles: [],
        riskPoints: [],
      },
      tasks: [],
      workflowRepositories: [
        {
          id: 'wr_1',
          repositoryId: 'repo_1',
          name: 'ai-platform',
          url: 'https://github.com/org/repo.git',
          baseBranch: 'main',
          workingBranch: 'flowx/work/login-modal/12345678',
        },
      ],
    });

    expect(handoff.repositories[0].workingBranch).toBe('flowx/work/login-modal/12345678');
    expect(handoff.repositories[0].checkout.checkout).toContain('flowx/work/login-modal/12345678');
    expect(handoff.repositories[0].checkout.checkout).toContain('origin/main');
    expect(handoff.repositories[0].checkout.push).toContain('flowx/work/login-modal/12345678');
  });

  it('includes suggested commit message with workflow id snippet', () => {
    const handoff = buildLocalHandoff({
      workflowRunId: 'cmworkflow12345678',
      status: 'EXECUTION_RUNNING',
      requirement: {
        id: 'req_1',
        title: 'Login welcome modal',
        description: 'desc',
        acceptanceCriteria: 'ac',
      },
      plan: {
        summary: 'Plan',
        implementationPlan: [],
        filesToModify: [],
        newFiles: [],
        riskPoints: [],
      },
      tasks: [],
      workflowRepositories: [
        {
          id: 'wr_1',
          repositoryId: null,
          name: 'demo',
          url: 'https://example.com/repo.git',
          baseBranch: 'develop',
          workingBranch: 'flowx/work/login-modal/12345678',
        },
      ],
    });

    expect(handoff.repositories[0].suggestedCommitMessage).toContain('12345678');
    expect(handoff.repositories[0].suggestedCommitMessage).toContain('Login welcome modal');
  });
});
