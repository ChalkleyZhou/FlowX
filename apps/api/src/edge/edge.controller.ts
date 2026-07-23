import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { SourceTool } from '@flowx-ai/protocol';
import { ContextPackageService } from './context-package.service';
import { StartEdgeHandoffDto } from './dto/start-edge-handoff.dto';
import { EdgeHandoffService } from './edge-handoff.service';
import { EdgeTasksService, type EdgeTaskType, type EdgeWorkflowSession } from './edge-tasks.service';

@Controller('edge')
export class EdgeController {
  constructor(
    private readonly edgeTasksService: EdgeTasksService,
    private readonly contextPackageService: ContextPackageService,
    private readonly edgeHandoffService: EdgeHandoffService,
  ) {}

  @Get('tasks')
  listTasks(@Query('workspaceId') workspaceId: string | undefined, @Req() req: EdgeRequest) {
    return this.edgeTasksService.listTasks({ workspaceId, session: req.authSession });
  }

  @Get('tasks/:type/:id/context')
  getContext(
    @Param('type') type: EdgeTaskType,
    @Param('id') id: string,
    @Query('sourceTool') sourceTool: SourceTool | undefined,
  ) {
    return this.contextPackageService.getContextPackage(type, id, sourceTool ?? 'cursor');
  }

  @Post('handoffs')
  startHandoff(@Body() dto: StartEdgeHandoffDto, @Req() req: EdgeRequest) {
    return this.edgeHandoffService.startHandoff(dto, req.authSession);
  }
}

type EdgeRequest = { authSession?: EdgeWorkflowSession };
