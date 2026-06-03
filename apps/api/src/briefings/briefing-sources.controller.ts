import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
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

  @Get('repository-binding')
  resolveRepositoryBinding(
    @Query('workspaceId') workspaceId: string,
    @Query('repositoryId') repositoryId: string,
  ) {
    return this.briefingSourcesService.resolveRepositoryBinding(workspaceId, repositoryId);
  }

  @Post()
  create(@Body() dto: CreateBriefingSourceDto) {
    return this.briefingSourcesService.createSource(dto);
  }

  @Post(':id/regenerate-webhook-secret')
  regenerateWebhookSecret(@Param('id') id: string) {
    return this.briefingSourcesService.regenerateWebhookSecret(id);
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
  @Post(':id/webhook')
  receiveWebhook(
    @Param('id') id: string,
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-gitlab-token') gitlabToken: string | undefined,
    @Headers('x-hub-signature-256') githubSignature: string | undefined,
    @Headers('x-github-event') githubEvent: string | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.briefingSourcesService.receiveWebhook(id, {
      gitlabToken,
      githubSignature,
      githubEvent,
      payload,
      rawBody: request.rawBody,
    });
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
