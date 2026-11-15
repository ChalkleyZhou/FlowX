import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { WorkflowRunStatus } from '../common/enums';
import { PrismaService } from '../prisma/prisma.service';
import { buildLocalChatPrompt } from '../workflow/local-chat-prompt';
import { WorkflowService } from '../workflow/workflow.service';
import { ContextPackageService } from './context-package.service';
import { WorkItemsService } from '../work-items/work-items.service';
import type { StartEdgeHandoffDto } from './dto/start-edge-handoff.dto';
import type { EdgeWorkflowSession } from './edge-tasks.service';

@Injectable()
export class EdgeHandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowService: WorkflowService,
    private readonly contextPackageService: ContextPackageService,
    @Optional() private readonly workItemsService?: WorkItemsService,
  ) {}

  async startHandoff(dto: StartEdgeHandoffDto, session?: EdgeWorkflowSession) {
    const executionItem = await this.prisma.executionItem.findUnique({
      where: { id: dto.executionItemId },
      include: { executionPlan: { include: { workItem: true, workflowRun: true } } },
    });
    if (!executionItem) throw new NotFoundException('执行项不存在。');
    const workflow = executionItem.executionPlan.workflowRun;
    if (!workflow) throw new ConflictException('执行项尚未绑定工作流。');
    const status = workflow.status.toLowerCase();
    if (status !== WorkflowRunStatus.EXECUTION_PENDING && status !== WorkflowRunStatus.EXECUTION_RUNNING) {
      throw new ConflictException('当前工作流尚未进入本地执行阶段。');
    }
    const claimed = status === WorkflowRunStatus.EXECUTION_PENDING
      ? await this.workflowService.claimLocalExecution(workflow.id, session, dto.sourceTool, dto.claimKey, dto.executionItemId)
      : {
          workflow,
          handoff: await (async () => {
            if (!this.workItemsService) return this.workflowService.getLocalHandoff(workflow.id);
            if (!session?.user.id) throw new ConflictException('领取执行项需要登录用户。');
            await this.workItemsService.claimExecutionItem(dto.executionItemId, { userId: session.user.id, claimKey: dto.claimKey }, session);
            return this.workflowService.getLocalHandoff(workflow.id);
          })(),
        };
    return this.buildResult(dto, claimed.workflow, claimed.handoff);
  }

  private buildResult(
    dto: StartEdgeHandoffDto,
    workflow: { id: string; status: string },
    handoff: Awaited<ReturnType<WorkflowService['getLocalHandoff']>>,
  ) {
    const repository = handoff.repositories[0];
    const chatPrompt = buildLocalChatPrompt({
      sourceTool: dto.sourceTool,
      kind: handoff.workItem.kind as 'REQUIREMENT' | 'ISSUE',
      workItemId: handoff.workItem.id,
      executionItemId: dto.executionItemId,
      workflowRunId: handoff.workflowRunId,
      title: handoff.executionItem.title,
      description: handoff.executionItem.description || handoff.workItem.description,
      acceptanceCriteria: handoff.workItem.acceptanceCriteria,
      repository: {
        name: repository?.name ?? 'unknown',
        url: repository?.url ?? null,
        workingBranch: repository?.workingBranch ?? '',
      },
    });
    return {
      workflow,
      handoff,
      contextPackage: this.contextPackageService.fromHandoff({
        executionItemId: dto.executionItemId,
        sourceTool: dto.sourceTool,
        handoff,
      }),
      chatPrompt,
      sourceTool: dto.sourceTool,
      executionItemId: dto.executionItemId,
      workItemId: handoff.workItem.id,
    };
  }
}
