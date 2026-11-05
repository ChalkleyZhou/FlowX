import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { BriefingFeedsService } from './briefing-feeds.service';
import { BriefingsService } from './briefings.service';
import { CreateBriefingFeedDto, UpdateBriefingFeedDto } from './dto/briefing-feed.dto';
import { GenerateBriefingDto } from './dto/generate-briefing.dto';

@Controller()
export class BriefingsController {
  constructor(
    private readonly briefingsService: BriefingsService,
    private readonly briefingFeedsService: BriefingFeedsService,
  ) {}

  @Get('projects/:id/briefing-feeds')
  listFeeds(@Param('id') id: string) {
    return this.briefingFeedsService.listFeeds(id);
  }

  @Post('projects/:id/briefing-feeds')
  createFeed(@Param('id') id: string, @Body() dto: CreateBriefingFeedDto) {
    return this.briefingFeedsService.createFeed(id, dto);
  }

  @Get('briefing-feeds/:id')
  getFeed(@Param('id') id: string) {
    return this.briefingFeedsService.getFeed(id);
  }

  @Patch('briefing-feeds/:id')
  updateFeed(@Param('id') id: string, @Body() dto: UpdateBriefingFeedDto) {
    return this.briefingFeedsService.updateFeed(id, dto);
  }

  @Delete('briefing-feeds/:id')
  deleteFeed(@Param('id') id: string) {
    return this.briefingFeedsService.deleteFeed(id);
  }

  @Get('projects/:id/briefings')
  listProjectBriefings(@Param('id') id: string) {
    return this.briefingsService.listProjectBriefings(id);
  }

  @Post('briefing-feeds/:id/generate')
  generateFeedBriefing(
    @Param('id') id: string,
    @Body() dto: GenerateBriefingDto,
    @Req() req: BriefingRequest,
  ) {
    return this.briefingsService.generateFeedBriefing(id, dto, req.authSession, {
      async: true,
    });
  }

  @Get('briefings/:id')
  getBriefing(@Param('id') id: string) {
    return this.briefingsService.getBriefing(id);
  }

  @Post('briefings/:id/send')
  sendBriefing(@Param('id') id: string) {
    return this.briefingsService.sendBriefing(id);
  }
}

type BriefingRequest = {
  authSession?: {
    user?: {
      id?: string;
      displayName?: string;
    } | null;
    organization?: {
      id?: string | null;
      name?: string | null;
      providerOrganizationId?: string | null;
    } | null;
  };
};
