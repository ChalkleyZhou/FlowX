import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { CreateWorkItemDto } from './dto/create-work-item.dto';
import { CreateExecutionItemDto } from './dto/create-execution-item.dto';
import { ExecutionItemActionDto } from './dto/execution-item-action.dto';
import { GenerateExecutionPlanDto } from './dto/generate-execution-plan.dto';
import { ListWorkItemsDto } from './dto/list-work-items.dto';
import { UpdateWorkItemDto } from './dto/update-work-item.dto';
import { StartWorkItemWorkflowDto } from './dto/start-work-item-workflow.dto';
import { WorkItemsService } from './work-items.service';

@Controller()
export class WorkItemsController {
  constructor(private readonly workItemsService: WorkItemsService) {}

  @Get('work-items')
  listGlobal(@Query() query: ListWorkItemsDto, @Req() req: WorkItemsRequest) {
    return this.workItemsService.listGlobal(query, req.authSession);
  }

  @Post('work-items')
  createGlobal(@Body() dto: CreateWorkItemDto, @Req() req: WorkItemsRequest) {
    if (!dto.projectId || !dto.versionId) {
      throw new BadRequestException('创建工作项必须指定 projectId 和 versionId。');
    }
    return this.workItemsService.create(dto.projectId, dto.versionId, dto, req.authSession);
  }

  @Get('projects/:projectId/versions/:versionId/work-items')
  list(@Param('projectId') projectId: string, @Param('versionId') versionId: string, @Query() query: ListWorkItemsDto, @Req() req: WorkItemsRequest) {
    return this.workItemsService.listByVersion(projectId, versionId, query, req.authSession);
  }

  @Post('projects/:projectId/versions/:versionId/work-items')
  create(@Param('projectId') projectId: string, @Param('versionId') versionId: string, @Body() dto: CreateWorkItemDto, @Req() req: WorkItemsRequest) {
    return this.workItemsService.create(projectId, versionId, dto, req.authSession);
  }

  @Get('work-items/:id')
  findOne(@Param('id') id: string, @Req() req: WorkItemsRequest) {
    return this.workItemsService.findOne(id, req.authSession);
  }

  @Patch('work-items/:id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkItemDto, @Req() req: WorkItemsRequest) {
    return this.workItemsService.update(id, dto, req.authSession);
  }

  @Delete('work-items/:id')
  remove(@Param('id') id: string, @Req() req: WorkItemsRequest) {
    return this.workItemsService.remove(id, req.authSession);
  }

  @Post('work-items/:id/execution-plans/:planId/confirm')
  confirmPlan(@Param('id') id: string, @Param('planId') planId: string, @Req() req: WorkItemsRequest) {
    return this.workItemsService.confirmPlan(id, planId, req.authSession);
  }

  @Post('work-items/:id/execution-plans/:planId/generate')
  generatePlan(@Param('id') id: string, @Param('planId') planId: string, @Body() dto: GenerateExecutionPlanDto, @Req() req: WorkItemsRequest) {
    return this.workItemsService.generateExecutionPlan(id, planId, dto, req.authSession);
  }

  @Post('work-items/:id/workflow-runs')
  startWorkflow(@Param('id') id: string, @Body() body: StartWorkItemWorkflowDto, @Req() req: WorkItemsRequest) {
    return this.workItemsService.startWorkflow(id, body, req.authSession);
  }

  @Post('work-items/:id/execution-plans/:planId/items')
  addExecutionItem(@Param('id') id: string, @Param('planId') planId: string, @Body() dto: CreateExecutionItemDto, @Req() req: WorkItemsRequest) {
    return this.workItemsService.addExecutionItem(id, planId, dto, req.authSession);
  }

  @Post('execution-items/:id/claim')
  claim(@Param('id') id: string, @Body() body: { claimKey: string }, @Req() req: WorkItemsRequest) {
    return this.workItemsService.claimExecutionItem(id, { claimKey: body.claimKey, userId: req.authSession?.user?.id || '' }, req.authSession);
  }

  @Post('execution-items/:id/complete')
  complete(@Param('id') id: string, @Body() body: ExecutionItemActionDto, @Req() req: WorkItemsRequest) {
    return this.workItemsService.completeExecutionItem(id, { claimKey: body.claimKey, summary: body.summary, evidence: body.evidence, userId: req.authSession?.user?.id || '' }, req.authSession);
  }

  @Post('execution-items/:id/block')
  block(@Param('id') id: string, @Body() body: ExecutionItemActionDto, @Req() req: WorkItemsRequest) {
    return this.workItemsService.blockExecutionItem(id, { claimKey: body.claimKey, reason: body.reason || '', userId: req.authSession?.user?.id || '' }, req.authSession);
  }

  @Post('execution-items/:id/cancel')
  cancel(@Param('id') id: string, @Body() body: ExecutionItemActionDto, @Req() req: WorkItemsRequest) {
    return this.workItemsService.cancelExecutionItem(id, { claimKey: body.claimKey, reason: body.reason || '', userId: req.authSession?.user?.id || '' }, req.authSession);
  }
}

type WorkItemsRequest = { authSession?: { user?: { id?: string; displayName?: string }; organization?: { id?: string | null } | null } };
