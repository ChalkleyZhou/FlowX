import { Controller, Get, Param, Post } from '@nestjs/common';
import { LocalDevPreviewService } from './local-dev-preview.service';

@Controller()
export class LocalDevPreviewController {
  constructor(private readonly localDevPreviewService: LocalDevPreviewService) {}

  @Get('repositories/:id/local-dev')
  detect(@Param('id') id: string) {
    return this.localDevPreviewService.detectRepositoryCommand(id);
  }

  @Get('repositories/:id/local-dev/status')
  status(@Param('id') id: string) {
    return this.localDevPreviewService.getStatus(id);
  }

  @Post('repositories/:id/local-dev/start')
  start(@Param('id') id: string) {
    return this.localDevPreviewService.start(id);
  }

  @Post('repositories/:id/local-dev/stop')
  stop(@Param('id') id: string) {
    return this.localDevPreviewService.stop(id);
  }
}
