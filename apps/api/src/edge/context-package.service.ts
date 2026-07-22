import { Injectable } from '@nestjs/common';
import {
  FLOWX_PROTOCOL_VERSION,
  type ContextPackage,
  type SourceTool,
} from 'flowx-protocol';
import { PrismaService } from '../prisma/prisma.service';
import type { LocalHandoffPayload } from '../workflow/workflow-local-handoff';
import type { EdgeTaskType } from './edge-tasks.service';

type BugContext = {
  title?: string | null;
  description?: string | null;
  expectedBehavior?: string | null;
  actualBehavior?: string | null;
  reproductionSteps?: unknown;
};

@Injectable()
export class ContextPackageService {
  constructor(private readonly prisma: PrismaService) {}

  async getLegacyTaskContext(type: EdgeTaskType, id: string) {
    if (type === 'requirement') {
      return this.prisma.requirement.findUniqueOrThrow({
        where: { id },
        include: {
          requirementRepositories: { include: { repository: true } },
        },
      });
    }
    return this.prisma.bug.findUniqueOrThrow({
      where: { id },
      include: { repository: true, fixWorkflowRun: true },
    });
  }

  async getContextPackage(type: EdgeTaskType, id: string, sourceTool: SourceTool) {
    const task = await this.getLegacyTaskContext(type, id);
    if (type === 'requirement') {
      const requirement = task as {
        id: string;
        title: string;
        description: string;
        acceptanceCriteria: string;
        requirementRepositories: Array<{
          repository: { id: string; name: string; url: string | null; defaultBranch?: string | null };
        }>;
      };
      return this.createPackage({
        sourceTool,
        task: {
          type,
          id: requirement.id,
          title: requirement.title,
          description: requirement.description,
          acceptanceCriteria: requirement.acceptanceCriteria,
        },
        repositories: requirement.requirementRepositories.map(({ repository }) => ({
          repositoryId: repository.id,
          name: repository.name,
          url: repository.url,
          baseBranch: repository.defaultBranch ?? undefined,
        })),
      });
    }

    const bug = task as {
      id: string;
      title: string;
      description?: string | null;
      expectedBehavior?: string | null;
      actualBehavior?: string | null;
      reproductionSteps?: unknown;
      repository?: { id: string; name: string; url: string | null; defaultBranch?: string | null } | null;
    };
    return this.createPackage({
      sourceTool,
      task: {
        type,
        id: bug.id,
        title: bug.title,
        description: bug.description,
        expectedBehavior: bug.expectedBehavior,
        actualBehavior: bug.actualBehavior,
        reproductionSteps: Array.isArray(bug.reproductionSteps)
          ? bug.reproductionSteps.map(String)
          : [],
      },
      repositories: bug.repository
        ? [
            {
              repositoryId: bug.repository.id,
              name: bug.repository.name,
              url: bug.repository.url,
              baseBranch: bug.repository.defaultBranch ?? undefined,
            },
          ]
        : [],
    });
  }

  fromHandoff(input: {
    taskType: EdgeTaskType;
    taskId: string;
    sourceTool: SourceTool;
    handoff: LocalHandoffPayload;
    bugContext?: BugContext | null;
  }): ContextPackage {
    const { handoff, bugContext } = input;
    return this.createPackage({
      sourceTool: input.sourceTool,
      task: {
        type: input.taskType,
        id: input.taskId,
        title: bugContext?.title ?? handoff.requirement.title,
        description: bugContext?.description ?? handoff.requirement.description,
        acceptanceCriteria:
          input.taskType === 'requirement'
            ? handoff.requirement.acceptanceCriteria
            : undefined,
        expectedBehavior: bugContext?.expectedBehavior,
        actualBehavior: bugContext?.actualBehavior,
        reproductionSteps: Array.isArray(bugContext?.reproductionSteps)
          ? bugContext.reproductionSteps.map(String)
          : [],
      },
      workflowRunId: handoff.workflowRunId,
      executionSessionId: handoff.executionSessionId ?? null,
      repositories: handoff.repositories.map((repository) => ({
        repositoryId: repository.repositoryId ?? repository.workflowRepositoryId,
        workflowRepositoryId: repository.workflowRepositoryId,
        name: repository.name,
        url: repository.url || null,
        baseBranch: repository.baseBranch,
        workingBranch: repository.workingBranch,
      })),
      metadata: { status: handoff.status, executor: handoff.executor },
    });
  }

  private createPackage(
    input: Omit<ContextPackage, 'protocolVersion' | 'generatedAt'>,
  ): ContextPackage {
    return {
      protocolVersion: FLOWX_PROTOCOL_VERSION,
      generatedAt: new Date().toISOString(),
      ...input,
    };
  }
}
