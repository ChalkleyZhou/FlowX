import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
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

  @Post(':id/task-split/run')
  runTaskSplit(@Param('id') id: string) {
    return this.workflowService.runTaskSplit(id);
  }

  @Post(':id/task-split/revise')
  reviseTaskSplit(@Param('id') id: string, @Body() dto: StageFeedbackDto) {
    return this.workflowService.runTaskSplit(id, dto.feedback);
  }

  @Patch(':id/task-split/manual-edit')
  manualEditTaskSplit(@Param('id') id: string, @Body() dto: StageManualEditDto) {
    return this.workflowService.manualEditTaskSplit(id, dto.output);
  }

  @Post(':id/task-split/confirm')
  confirmTaskSplit(@Param('id') id: string) {
    return this.workflowService.confirmTaskSplit(id);
  }

  @Post(':id/task-split/reject')
  rejectTaskSplit(@Param('id') id: string) {
    return this.workflowService.rejectTaskSplit(id);
  }

  @Post(':id/plan/run')
  runPlan(@Param('id') id: string) {
    return this.workflowService.runPlan(id);
  }

  @Post(':id/plan/revise')
  revisePlan(@Param('id') id: string, @Body() dto: StageFeedbackDto) {
    return this.workflowService.runPlan(id, dto.feedback);
  }

  @Patch(':id/plan/manual-edit')
  manualEditPlan(@Param('id') id: string, @Body() dto: StageManualEditDto) {
    return this.workflowService.manualEditPlan(id, dto.output);
  }

  @Post(':id/plan/confirm')
  confirmPlan(@Param('id') id: string) {
    return this.workflowService.confirmPlan(id);
  }

  @Post(':id/plan/reject')
  rejectPlan(@Param('id') id: string) {
    return this.workflowService.rejectPlan(id);
  }

  @Post(':id/execution/run')
  runExecution(@Param('id') id: string) {
    return this.workflowService.runExecution(id);
  }

  @Post(':id/execution/revise')
  reviseExecution(@Param('id') id: string, @Body() dto: StageFeedbackDto) {
    return this.workflowService.runExecution(id, dto.feedback);
  }

  @Patch(':id/execution/manual-edit')
  manualEditExecution(@Param('id') id: string, @Body() dto: StageManualEditDto) {
    return this.workflowService.manualEditExecution(id, dto.output);
  }

  @Post(':id/review/run')
  runReview(@Param('id') id: string) {
    return this.workflowService.runReview(id);
  }

  @Post(':id/review/revise')
  reviseReview(@Param('id') id: string, @Body() dto: StageFeedbackDto) {
    return this.workflowService.runReview(id, dto.feedback);
  }

  @Patch(':id/review/manual-edit')
  manualEditReview(@Param('id') id: string, @Body() dto: StageManualEditDto) {
    return this.workflowService.manualEditReview(id, dto.output);
  }

  @Post(':id/human-review/decision')
  decideHumanReview(
    @Param('id') id: string,
    @Body() dto: HumanReviewDecisionDto,
  ) {
    return this.workflowService.decideHumanReview(id, dto.decision);
  }
}
