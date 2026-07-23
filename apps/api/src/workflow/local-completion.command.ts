import { BadRequestException, Logger } from '@nestjs/common';
import type { CompletionReport } from '@flowx-ai/protocol';
import { StageType } from '../common/enums';
import type { ExecuteTaskOutput } from '../common/types';
import type { CompleteLocalExecutionDto } from './dto/complete-local-execution.dto';
import { buildExecutionOutputFromLocalReport } from './workflow-local-execution-output';
import type { LocalHandoffPayload } from './workflow-local-handoff';
import { WorkflowArtifactService } from './workflow-artifact.service';
import { WorkflowGitRemoteService } from './workflow-git-remote.service';
import type {
  LocalExecutionSessionProjection,
  WorkflowNotificationRecipient,
  WorkflowPayload,
} from './workflow.service';

export type LocalCompletionVerificationRow = {
  workflowRepositoryId: string;
  verified: boolean;
};

export type LocalCompletionStageOutput = ExecuteTaskOutput & {
  _artifact?: {
    kind: 'execution';
    version: number;
    htmlPath: string;
    metaPath: string;
    sha256: string;
  };
};

/**
 * The subset of `WorkflowService` behavior that stays with the workflow state machine:
 * loading/persisting the `WorkflowRun`, the local-execution guard rails, output sanitization,
 * and the stage/status transition + notification side effects. `LocalCompletionCommand` owns
 * the completion-specific orchestration (validate report → verify remotes → build artifact)
 * and calls back into this gateway for everything that touches shared workflow internals, so
 * the state machine logic is not duplicated outside `workflow.service.ts`.
 */
export interface LocalCompletionWorkflowGateway {
  getWorkflowOrThrow(workflowRunId: string): Promise<WorkflowPayload>;
  buildCompletionReport(
    executionSessionId: string,
    handoff: LocalHandoffPayload,
    dto: CompleteLocalExecutionDto,
  ): CompletionReport;
  readCompletionIdempotencyKey(metadata: unknown): string | null;
  assertLocalExecutionActive(workflow: WorkflowPayload): void;
  sanitizeExecutionOutputPaths(
    output: ExecuteTaskOutput,
    repositories?: WorkflowPayload['workflowRepositories'],
  ): ExecuteTaskOutput;
  getLatestStageOrThrow(
    workflow: WorkflowPayload,
    stage: StageType,
  ): { attempt: number; input: unknown };
  finalizeExecutionSuccess(
    workflowRunId: string,
    stageOutput: LocalCompletionStageOutput,
    options: {
      triggerType?: string;
      notifyRecipient?: WorkflowNotificationRecipient | null;
      executor: 'LOCAL';
      requirementTitle: string;
      localCompletion?: {
        executionSession: LocalExecutionSessionProjection;
        completionReport: CompletionReport;
        verificationRows: LocalCompletionVerificationRow[];
        repositories: LocalHandoffPayload['repositories'];
      };
    },
  ): Promise<void>;
}

export interface LocalCompletionCommandParams {
  workflow: WorkflowPayload;
  executionSession: LocalExecutionSessionProjection | null;
  handoff: LocalHandoffPayload;
  dto: CompleteLocalExecutionDto;
  notifyRecipient: WorkflowNotificationRecipient | null;
  gateway: LocalCompletionWorkflowGateway;
}

export interface LocalCompletionCommandResult {
  workflow: WorkflowPayload;
  handoff: LocalHandoffPayload;
}

/**
 * Single server-side implementation of local execution completion (design spec §6.2):
 * validate the agent-reported repositories against the workflow handoff, verify pushed
 * remotes, attach the execution artifact, then hand off to the workflow gateway to advance
 * state and complete the execution session. Both `POST /execution-sessions/:id/complete`
 * (via `WorkflowService.completeLocalExecutionBySession`) and the compatibility
 * `POST /workflow-runs/:id/execution/complete-local` (via `WorkflowService.completeLocalExecution`)
 * route through this command so there is exactly one implementation.
 */
export class LocalCompletionCommand {
  private readonly logger = new Logger(LocalCompletionCommand.name);

  constructor(
    private readonly workflowArtifactService: WorkflowArtifactService,
    private readonly workflowGitRemoteService: WorkflowGitRemoteService,
  ) {}

  async run(params: LocalCompletionCommandParams): Promise<LocalCompletionCommandResult> {
    const { workflow, executionSession, handoff, dto, notifyRecipient, gateway } = params;

    const completionReport = executionSession
      ? gateway.buildCompletionReport(executionSession.id, handoff, dto)
      : null;

    if (workflow.status !== 'EXECUTION_RUNNING') {
      if (
        executionSession?.status === 'COMPLETED' &&
        completionReport &&
        gateway.readCompletionIdempotencyKey(executionSession.metadata) === completionReport.idempotencyKey
      ) {
        return { workflow, handoff };
      }
      gateway.assertLocalExecutionActive(workflow);
    }
    gateway.assertLocalExecutionActive(workflow);

    const repoByWrId = new Map(
      handoff.repositories.map((repository) => [repository.workflowRepositoryId, repository]),
    );

    for (const report of dto.repositories) {
      if (!repoByWrId.has(report.workflowRepositoryId)) {
        throw new BadRequestException(`Unknown workflow repository: ${report.workflowRepositoryId}`);
      }
    }

    const requiresRemote = handoff.repositories.some((repository) => repository.url.trim());
    if (requiresRemote && !dto.pushed) {
      throw new BadRequestException('请先 push 到远程后再完成本地执行。');
    }

    const verificationRows: LocalCompletionVerificationRow[] = [];
    if (dto.pushed) {
      for (const report of dto.repositories) {
        const repository = repoByWrId.get(report.workflowRepositoryId)!;
        if (!repository.url.trim()) {
          verificationRows.push({ workflowRepositoryId: report.workflowRepositoryId, verified: false });
          continue;
        }
        const verified = await this.workflowGitRemoteService.verifyBranchTip(
          repository.url,
          repository.workingBranch,
          report.headSha,
        );
        if (!verified) {
          throw new BadRequestException({
            code: 'REMOTE_BRANCH_NOT_VERIFIED',
            message: `远程分支 ${repository.workingBranch} 未找到提交 ${report.headSha.slice(0, 12)}，请先 push。`,
          });
        }
        verificationRows.push({ workflowRepositoryId: report.workflowRepositoryId, verified: true });
      }
    }

    const rawOutput = buildExecutionOutputFromLocalReport(handoff, dto);
    const output = gateway.sanitizeExecutionOutputPaths(rawOutput, workflow.workflowRepositories);
    const executionStage = gateway.getLatestStageOrThrow(workflow, StageType.EXECUTION);
    const stageOutput = await this.attachExecutionArtifactToOutput(
      workflow.id,
      executionStage.attempt,
      output,
      handoff,
      dto,
      verificationRows,
    );

    const triggerType =
      typeof executionStage.input === 'object' &&
      executionStage.input !== null &&
      !Array.isArray(executionStage.input)
        ? String((executionStage.input as Record<string, unknown>).triggerType ?? '') || undefined
        : undefined;

    await gateway.finalizeExecutionSuccess(workflow.id, stageOutput, {
      triggerType,
      notifyRecipient,
      executor: 'LOCAL',
      requirementTitle: workflow.requirement.title,
      localCompletion:
        executionSession && completionReport
          ? {
              executionSession,
              completionReport,
              verificationRows,
              repositories: handoff.repositories,
            }
          : undefined,
    });

    const updated = await gateway.getWorkflowOrThrow(workflow.id);
    return { workflow: updated, handoff };
  }

  private async attachExecutionArtifactToOutput(
    workflowRunId: string,
    version: number,
    output: ExecuteTaskOutput,
    handoff: LocalHandoffPayload,
    dto: CompleteLocalExecutionDto,
    verificationRows: LocalCompletionVerificationRow[],
  ): Promise<LocalCompletionStageOutput> {
    const verifiedById = new Map(verificationRows.map((row) => [row.workflowRepositoryId, row.verified]));
    const repoByWrId = new Map(
      handoff.repositories.map((repository) => [repository.workflowRepositoryId, repository]),
    );

    try {
      const repositoryRows = dto.repositories.map((report) => {
        const repository = repoByWrId.get(report.workflowRepositoryId)!;
        return {
          name: repository.name,
          workingBranch: repository.workingBranch,
          headSha: report.headSha,
          changedFileCount: report.changedFiles.length,
          pushed: dto.pushed,
          verified: verifiedById.get(report.workflowRepositoryId) ?? false,
        };
      });

      const completedAt = new Date().toISOString();
      const { htmlPath, metaPath, sha256 } = await this.workflowArtifactService.writeExecutionArtifact({
        workflowRunId,
        version,
        executor: 'LOCAL',
        patchSummary: output.patchSummary,
        changedFiles: output.changedFiles,
        repositoryRows,
        pushed: dto.pushed,
        meta: {
          executor: 'LOCAL',
          status: 'COMPLETED',
          completedAt,
          patchSummary: output.patchSummary,
          changedFiles: output.changedFiles,
          pushed: dto.pushed,
          repositories: dto.repositories.map((report) => {
            const repository = repoByWrId.get(report.workflowRepositoryId)!;
            return {
              workflowRepositoryId: report.workflowRepositoryId,
              name: repository.name,
              workingBranch: repository.workingBranch,
              headSha: report.headSha,
              changedFiles: report.changedFiles,
              verified: verifiedById.get(report.workflowRepositoryId) ?? false,
            };
          }),
        },
      });

      return {
        ...output,
        _artifact: {
          kind: 'execution',
          version,
          htmlPath,
          metaPath,
          sha256,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to write execution artifact for workflow ${workflowRunId}: ${message}`);
      return { ...output };
    }
  }
}
