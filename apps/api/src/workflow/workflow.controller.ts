import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateWorkflowRunDto } from './dto/create-workflow-run.dto';
import { HumanReviewDecisionDto } from './dto/human-review-decision.dto';
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

  @Post(':id/review/run')
  runReview(@Param('id') id: string) {
    return this.workflowService.runReview(id);
  }

  @Post(':id/human-review/decision')
  decideHumanReview(
    @Param('id') id: string,
    @Body() dto: HumanReviewDecisionDto,
  ) {
    return this.workflowService.decideHumanReview(id, dto.decision);
  }
}

