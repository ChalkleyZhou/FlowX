import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { CompleteLocalExecutionDto } from './dto/complete-local-execution.dto';
import { CreateWorkflowRunDto } from './dto/create-workflow-run.dto';
import { HumanReviewDecisionDto } from './dto/human-review-decision.dto';
import { StageFeedbackDto } from './dto/stage-feedback.dto';
import { SubmitLocalDesignDto } from './dto/submit-local-design.dto';
import { StageManualEditDto } from './dto/stage-manual-edit.dto';
import { LocalLaunchService } from './local-launch.service';
import { WorkflowService } from './workflow.service';

@Controller('workflow-runs')
export class WorkflowController {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly localLaunchService: LocalLaunchService,
  ) {}

  @Post()
  create(@Body() dto: CreateWorkflowRunDto) {
    return this.workflowService.createWorkflowRun(dto);
  }

  @Get('providers')
  listProviders() {
    return this.workflowService.listAiProviders();
  }

  @Get()
  findAll(@Query('runType') runType?: string) {
    return this.workflowService.findAll(runType ? { runType } : undefined);
  }

  @Get(':id/artifacts/plan')
  async getPlanArtifact(@Param('id') id: string, @Res({ passthrough: false }) res: any) {
    const html = await this.workflowService.readPlanArtifactHtml(id);
    res.type('text/html; charset=utf-8').send(html);
  }

  @Get(':id/artifacts/execution')
  async getExecutionArtifact(@Param('id') id: string, @Res({ passthrough: false }) res: any) {
    const html = await this.workflowService.readExecutionArtifactHtml(id);
    res.type('text/html; charset=utf-8').send(html);
  }

  @Get(':id/execution/local-handoff')
  getLocalHandoff(@Param('id') id: string) {
    return this.workflowService.getLocalHandoff(id);
  }

  @Get(':id/design-artifact')
  getDesignArtifact(@Param('id') id: string) {
    return this.workflowService.getWorkflowDesignArtifact(id);
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

  @Post(':id/rollback')
  rollbackToPreviousStage(@Param('id') id: string) {
    return this.workflowService.rollbackToPreviousStage(id);
  }

  @Post(':id/brainstorm/run')
  runBrainstorm(@Param('id') id: string, @Req() req: WorkflowRequest) {
    return this.workflowService.runBrainstorm(id, req.authSession);
  }

  @Post(':id/brainstorm/skip')
  skipBrainstorm(@Param('id') id: string) {
    return this.workflowService.skipBrainstorm(id);
  }

  @Post(':id/design/run')
  runDesign(@Param('id') id: string, @Req() req: WorkflowRequest) {
    return this.workflowService.runDesign(id, undefined, req.authSession);
  }

  @Post(':id/design/submit-local')
  submitLocalDesign(@Param('id') id: string, @Body() dto: SubmitLocalDesignDto) {
    return this.workflowService.submitLocalDesign(id, dto);
  }

  @Post(':id/design/revise')
  reviseDesign(@Param('id') id: string, @Body() dto: StageFeedbackDto, @Req() req: WorkflowRequest) {
    return this.workflowService.runDesign(id, dto.feedback, req.authSession);
  }

  @Post(':id/design/confirm')
  confirmDesign(@Param('id') id: string, @Req() req: WorkflowRequest) {
    return this.workflowService.confirmDesign(id, req.authSession);
  }

  @Post(':id/design/reject')
  rejectDesign(@Param('id') id: string) {
    return this.workflowService.rejectDesign(id);
  }

  @Post(':id/design/skip')
  skipDesign(@Param('id') id: string) {
    return this.workflowService.skipDesign(id);
  }

  @Post(':id/demo/run')
  runDemo(@Param('id') id: string, @Req() req: WorkflowRequest) {
    return this.workflowService.runDemo(id, undefined, req.authSession);
  }

  @Post(':id/demo/revise')
  reviseDemo(@Param('id') id: string, @Body() dto: StageFeedbackDto, @Req() req: WorkflowRequest) {
    return this.workflowService.runDemo(id, dto.feedback, req.authSession);
  }

  @Post(':id/demo/confirm')
  confirmDemo(@Param('id') id: string) {
    return this.workflowService.confirmDemo(id);
  }

  @Post(':id/demo/skip')
  skipDemo(@Param('id') id: string) {
    return this.workflowService.skipDemo(id);
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

  @Post(':id/execution/claim-local')
  claimLocalExecution(@Param('id') id: string, @Req() req: WorkflowRequest) {
    return this.workflowService.claimLocalExecution(id, req.authSession);
  }

  @Post(':id/execution/local-launch-ticket')
  issueLocalLaunchTicket(@Param('id') id: string, @Req() req: WorkflowRequest) {
    if (!req.authSession?.user?.id) {
      throw new UnauthorizedException('Missing authenticated user.');
    }
    return this.localLaunchService.issueTicket(id, req.authSession);
  }

  @Post(':id/execution/complete-local')
  completeLocalExecution(
    @Param('id') id: string,
    @Body() dto: CompleteLocalExecutionDto,
    @Req() req: WorkflowRequest,
  ) {
    return this.workflowService.completeLocalExecution(id, dto, req.authSession);
  }

  @Post(':id/execution/cancel-local')
  cancelLocalExecution(@Param('id') id: string) {
    return this.workflowService.cancelLocalExecution(id);
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
      id?: string | null;
      providerOrganizationId?: string | null;
      name?: string | null;
    } | null;
  };
};
