import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { LocalDevPreviewService } from './local-dev-preview.service';

@Controller()
export class LocalDevPreviewController {
  constructor(private readonly localDevPreviewService: LocalDevPreviewService) {}

  @Get('repositories/:id/local-dev')
  detect(@Param('id') id: string, @Query('workflowRunId') workflowRunId?: string) {
    return this.localDevPreviewService.detectRepositoryCommand(id, workflowRunId);
  }

  @Get('repositories/:id/local-dev/status')
  status(@Param('id') id: string, @Query('workflowRunId') workflowRunId?: string) {
    return this.localDevPreviewService.getStatus(id, workflowRunId);
  }

  @Post('repositories/:id/local-dev/start')
  start(@Param('id') id: string, @Query('workflowRunId') workflowRunId?: string) {
    return this.localDevPreviewService.start(id, workflowRunId);
  }

  @Post('repositories/:id/local-dev/stop')
  stop(@Param('id') id: string, @Query('workflowRunId') workflowRunId?: string) {
    return this.localDevPreviewService.stop(id, workflowRunId);
  }
}
