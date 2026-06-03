import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { BriefingSourcesService } from './briefing-sources.service';
import { CreateBriefingSourceDto } from './dto/create-briefing-source.dto';
import { UpdateBriefingSourceDto } from './dto/update-briefing-source.dto';

@Controller('briefing-sources')
export class BriefingSourcesController {
  constructor(private readonly briefingSourcesService: BriefingSourcesService) {}

  @Get()
  list(@Query('workspaceId') workspaceId?: string) {
    return this.briefingSourcesService.listSources(workspaceId);
  }

  @Post()
  create(@Body() dto: CreateBriefingSourceDto) {
    return this.briefingSourcesService.createSource(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBriefingSourceDto) {
    return this.briefingSourcesService.updateSource(id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.briefingSourcesService.deleteSource(id);
  }

  @Public()
  @Post(':id/gitlab-webhook')
  receiveGitlabWebhook(
    @Param('id') id: string,
    @Headers('x-gitlab-token') token: string | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.briefingSourcesService.receiveGitlabWebhook(id, token, payload);
  }
}

