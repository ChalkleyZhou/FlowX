import { withProjectLabels, workItemLabelsInclude } from '../projects/project-labels.service';
import { Injectable } from '@nestjs/common';
import {
  FLOWX_PROTOCOL_VERSION,
  type ContextPackage,
  type SourceTool,
} from '@flowx-ai/protocol';
import { PrismaService } from '../prisma/prisma.service';
import type { LocalHandoffPayload } from '../workflow/workflow-local-handoff';
import type { EdgeTaskKind } from './edge-tasks.service';

@Injectable()
export class ContextPackageService {
  constructor(private readonly prisma: PrismaService) {}

  async getTaskContext(executionItemId: string) {
    const result = await this.prisma.executionItem.findUniqueOrThrow({
      where: { id: executionItemId },
      include: {
        executionPlan: {
          include: {
            workItem: {
              include: {
                labels: workItemLabelsInclude,
                changes: { orderBy: { revision: 'asc' } },
                repository: true,
                requirementRepositories: { include: { repository: true } },
              },
            },
          },
        },
      },
    });
    return { ...result, executionPlan: { ...result.executionPlan, workItem: withProjectLabels(result.executionPlan.workItem) } };
  }

  async getContextPackage(executionItemId: string, sourceTool: SourceTool) {
    const executionItem = await this.getTaskContext(executionItemId);
    const workItem = executionItem.executionPlan.workItem;
    const repositories = workItem.repository
      ? [workItem.repository]
      : workItem.requirementRepositories.map(({ repository }) => repository);
    return this.createPackage({
      sourceTool,
      task: {
        kind: workItem.kind as EdgeTaskKind,
        id: executionItem.id,
        workItemId: workItem.id,
        executionItemId: executionItem.id,
        title: executionItem.title,
        labels: workItem.labels,
        description: executionItem.description || workItem.description,
        acceptanceCriteria: workItem.acceptanceCriteria,
        expectedBehavior: workItem.expectedBehavior,
        actualBehavior: workItem.actualBehavior,
        reproductionSteps: Array.isArray(workItem.reproductionSteps)
          ? workItem.reproductionSteps.map(String) : [],
        priority: workItem.priority,
        functionalModule: workItem.functionalModule,
        ...(workItem.riskImpact?.trim() ? { riskImpact: workItem.riskImpact.trim() } : {}),
        ...(workItem.productRequirementDocument?.trim() ? { productRequirementDocument: workItem.productRequirementDocument.trim() } : {}),
        ...(workItem.remark?.trim() ? { remark: workItem.remark.trim() } : {}),
        ...(workItem.createdByName?.trim() ? { createdByName: workItem.createdByName.trim() } : {}),
      },
      repositories: repositories.map((repository) => ({
        repositoryId: repository.id,
        name: repository.name,
        url: repository.url,
        baseBranch: repository.defaultBranch ?? undefined,
      })),
      metadata: { executionItemId, workItemId: workItem.id, workItemRevision: workItem.revision },
    });
  }

  fromHandoff(input: {
    executionItemId: string;
    sourceTool: SourceTool;
    handoff: LocalHandoffPayload;
  }): ContextPackage {
    const { handoff } = input;
    return this.createPackage({
      sourceTool: input.sourceTool,
      task: {
        kind: handoff.workItem.kind as EdgeTaskKind,
        id: input.executionItemId,
        workItemId: handoff.workItem.id,
        executionItemId: input.executionItemId,
        title: handoff.executionItem.title,
        labels: handoff.workItem.labels ?? [],
        description: handoff.executionItem.description || handoff.workItem.description,
        acceptanceCriteria: handoff.workItem.acceptanceCriteria,
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
      metadata: { status: handoff.status, executor: handoff.executor, executionItemId: input.executionItemId },
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
