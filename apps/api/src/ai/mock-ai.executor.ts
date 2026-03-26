import { Injectable } from '@nestjs/common';
import {
  ExecuteTaskInput,
  ExecuteTaskOutput,
  GeneratePlanInput,
  GeneratePlanOutput,
  ReviewCodeInput,
  ReviewCodeOutput,
  SplitTaskItem,
  SplitTasksInput,
  SplitTasksOutput,
} from '../common/types';
import { AIExecutor } from './ai-executor';

function createBaselineTasks(title: string): SplitTaskItem[] {
  return [
    {
      title: `Design domain model for ${title}`,
      description: 'Define entities, statuses, and persistence fields for the workflow.',
    },
    {
      title: `Build staged orchestration APIs for ${title}`,
      description: 'Implement requirement intake, task split, planning, and confirmation APIs.',
    },
    {
      title: `Prepare basic operator UI for ${title}`,
      description: 'Provide simple pages to inspect stage output and trigger human confirmation.',
    },
  ];
}

@Injectable()
export class MockAiExecutor implements AIExecutor {
  async splitTasks(input: SplitTasksInput): Promise<SplitTasksOutput> {
    return {
      tasks: createBaselineTasks(input.requirement.title),
      ambiguities: [
        'Whether execution should apply real patches or only store generated patch metadata in MVP.',
        'Whether human review decisions should be recorded per issue or per workflow run.',
      ],
      risks: [
        'Stage outputs can drift without strict schema validation.',
        'Workflow state can become inconsistent if stage transitions are not centralized.',
      ],
    };
  }

  async generatePlan(input: GeneratePlanInput): Promise<GeneratePlanOutput> {
    const taskTitles = input.tasks.map((task) => task.title);
    return {
      summary: `Implement a staged workflow service for "${input.requirement.title}" with explicit confirmation gates.`,
      implementationPlan: [
        'Create database models for workflow state, stage execution, tasks, plans, execution, and review artifacts.',
        'Implement centralized state machine guards for workflow and stage transitions.',
        `Expose REST APIs for confirmed tasks: ${taskTitles.join(', ')}.`,
        'Store AI stage outputs in structured JSON fields for reuse by later stages.',
      ],
      filesToModify: [
        'apps/api/src/workflow/workflow.service.ts',
        'apps/api/src/workflow/workflow.controller.ts',
        'prisma/schema.prisma',
      ],
      newFiles: [
        'apps/api/src/common/workflow-state-machine.ts',
        'apps/api/src/ai/ai-executor.ts',
        'apps/web/src/App.tsx',
      ],
      riskPoints: [
        'Prompt/template versions should be tracked to explain why outputs differ across runs.',
        'Rejected stages must not leave stale domain artifacts marked as confirmed.',
      ],
    };
  }

  async executeTask(input: ExecuteTaskInput): Promise<ExecuteTaskOutput> {
    return {
      patchSummary: `Execute approved plan for "${input.requirement.title}" across backend workflow orchestration and operator UI.`,
      changedFiles: [
        ...input.plan.filesToModify,
        ...input.plan.newFiles,
      ],
      codeChanges: [
        {
          file: 'apps/api/src/workflow/workflow.service.ts',
          changeType: 'update',
          summary: 'Add execution orchestration and persistence for confirmed plan output.',
        },
        {
          file: 'apps/api/src/workflow/workflow.controller.ts',
          changeType: 'update',
          summary: 'Expose execution and review endpoints guarded by workflow status.',
        },
        {
          file: 'apps/web/src/App.tsx',
          changeType: 'update',
          summary: 'Render execution and review actions in the workflow operator console.',
        },
      ],
    };
  }

  async reviewCode(_input: ReviewCodeInput): Promise<ReviewCodeOutput> {
    return {
      issues: ['Execution result currently stores patch metadata instead of applying VCS patches.'],
      bugs: ['No retry policy is defined for transient AI provider failures.'],
      missingTests: [
        'Workflow status transition tests for reject and rework branches.',
        'API integration tests for execution and review endpoints.',
      ],
      suggestions: [
        'Persist prompt version per stage execution for traceability.',
        'Add idempotency protection for run-stage endpoints.',
      ],
      impactScope: ['Backend workflow orchestration', 'Operator review UI', 'Prisma data model'],
    };
  }
}

