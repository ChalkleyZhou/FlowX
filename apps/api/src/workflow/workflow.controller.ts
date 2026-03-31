import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { CreateWorkflowRunDto } from './dto/create-workflow-run.dto';
import { HumanReviewDecisionDto } from './dto/human-review-decision.dto';
import { StageFeedbackDto } from './dto/stage-feedback.dto';
import { StageManualEditDto } from './dto/stage-manual-edit.dto';
import { WorkflowService } from './workflow.service';

@Controller('workflow-runs')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Post()
  create(@Body() dto: CreateWorkflowRunDto) {
    return this.workflowService.createWorkflowRun(dto);
  }

  @Get()
  findAll() {
    return this.workflowService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workflowService.findOne(id);
  }

  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.workflowService.getHistory(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.workflowService.deleteWorkflowRun(id);
  }

  @Post(':id/task-split/run')
  runTaskSplit(@Param('id') id: string, @Req() req: WorkflowRequest) {
    return this.workflowService.runTaskSplit(id, undefined, req.authSession);
  }

  @Post(':id/task-split/revise')
  reviseTaskSplit(@Param('id') id: string, @Body() dto: StageFeedbackDto, @Req() req: WorkflowRequest) {
    return this.workflowService.runTaskSplit(id, dto.feedback, req.authSession);
  }

  @Patch(':id/task-split/manual-edit')
  manualEditTaskSplit(@Param('id') id: string, @Body() dto: StageManualEditDto) {
    return this.workflowService.manualEditTaskSplit(id, dto.output);
  }

  @Post(':id/task-split/confirm')
  confirmTaskSplit(@Param('id') id: string, @Req() req: WorkflowRequest) {
    return this.workflowService.confirmTaskSplit(id, req.authSession);
  }

  @Post(':id/task-split/reject')
  rejectTaskSplit(@Param('id') id: string) {
    return this.workflowService.rejectTaskSplit(id);
  }

  @Post(':id/plan/run')
  runPlan(@Param('id') id: string, @Req() req: WorkflowRequest) {
    return this.workflowService.runPlan(id, undefined, req.authSession);
  }

  @Post(':id/plan/revise')
  revisePlan(@Param('id') id: string, @Body() dto: StageFeedbackDto, @Req() req: WorkflowRequest) {
    return this.workflowService.runPlan(id, dto.feedback, req.authSession);
  }

  @Patch(':id/plan/manual-edit')
  manualEditPlan(@Param('id') id: string, @Body() dto: StageManualEditDto) {
    return this.workflowService.manualEditPlan(id, dto.output);
  }

  @Post(':id/plan/confirm')
  confirmPlan(@Param('id') id: string, @Req() req: WorkflowRequest) {
    return this.workflowService.confirmPlan(id, req.authSession);
  }

  @Post(':id/plan/reject')
  rejectPlan(@Param('id') id: string) {
    return this.workflowService.rejectPlan(id);
  }

  @Post(':id/execution/run')
  runExecution(@Param('id') id: string, @Req() req: WorkflowRequest) {
    return this.workflowService.runExecution(id, undefined, undefined, req.authSession);
  }

  @Post(':id/execution/revise')
  reviseExecution(@Param('id') id: string, @Body() dto: StageFeedbackDto, @Req() req: WorkflowRequest) {
    return this.workflowService.runExecution(id, dto.feedback, undefined, req.authSession);
  }

  @Post(':id/review-findings/:findingId/fix')
  fixReviewFinding(@Param('id') id: string, @Param('findingId') findingId: string, @Req() req: WorkflowRequest) {
    return this.workflowService.fixReviewFinding(id, findingId, req.authSession);
  }

  @Post(':id/git/publish')
  publishGitChanges(@Param('id') id: string) {
    return this.workflowService.publishGitChanges(id);
  }

  @Patch(':id/execution/manual-edit')
  manualEditExecution(@Param('id') id: string, @Body() dto: StageManualEditDto) {
    return this.workflowService.manualEditExecution(id, dto.output);
  }

  @Post(':id/review/run')
  runReview(@Param('id') id: string, @Req() req: WorkflowRequest) {
    return this.workflowService.runReview(id, undefined, req.authSession);
  }

  @Post(':id/review/revise')
  reviseReview(@Param('id') id: string, @Body() dto: StageFeedbackDto, @Req() req: WorkflowRequest) {
    return this.workflowService.runReview(id, dto.feedback, req.authSession);
  }

  @Patch(':id/review/manual-edit')
  manualEditReview(@Param('id') id: string, @Body() dto: StageManualEditDto) {
    return this.workflowService.manualEditReview(id, dto.output);
  }

  @Post(':id/human-review/decision')
  decideHumanReview(
    @Param('id') id: string,
    @Body() dto: HumanReviewDecisionDto,
    @Req() req: WorkflowRequest,
  ) {
    return this.workflowService.decideHumanReview(id, dto.decision, req.authSession);
  }
}

type WorkflowRequest = {
  authSession?: {
    user: {
      id: string;
      displayName: string;
    };
    organization?: {
      providerOrganizationId?: string | null;
      name?: string | null;
    } | null;
  };
};
