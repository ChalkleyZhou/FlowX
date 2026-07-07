import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { BriefingsService } from './briefings.service';
import { DailyCodeReviewService } from './daily-code-review.service';
import { GenerateBriefingDto } from './dto/generate-briefing.dto';
import { GenerateDailyCodeReviewDto } from './dto/generate-daily-code-review.dto';
import { UpsertProjectBriefingConfigDto } from './dto/upsert-project-briefing-config.dto';

@Controller()
export class BriefingsController {
  constructor(
    private readonly briefingsService: BriefingsService,
    private readonly dailyCodeReviewService: DailyCodeReviewService,
  ) {}

  @Get('projects/:id/briefing-config')
  getProjectConfig(@Param('id') id: string) {
    return this.briefingsService.getProjectConfig(id);
  }

  @Put('projects/:id/briefing-config')
  updateProjectConfig(@Param('id') id: string, @Body() dto: UpsertProjectBriefingConfigDto) {
    return this.briefingsService.upsertProjectConfig(id, dto);
  }

  @Get('projects/:id/briefings')
  listProjectBriefings(@Param('id') id: string) {
    return this.briefingsService.listProjectBriefings(id);
  }

  @Post('projects/:id/briefings/generate')
  generateProjectBriefing(
    @Param('id') id: string,
    @Body() dto: GenerateBriefingDto,
    @Req() req: BriefingRequest,
  ) {
    return this.briefingsService.generateProjectBriefing(id, dto, req.authSession, {
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

  @Get('projects/:id/daily-code-reviews')
  listProjectDailyCodeReviews(@Param('id') id: string) {
    return this.dailyCodeReviewService.listProjectDailyCodeReviews(id);
  }

  @Post('projects/:id/daily-code-reviews/generate')
  generateProjectDailyCodeReview(
    @Param('id') id: string,
    @Body() dto: GenerateDailyCodeReviewDto,
    @Req() req: BriefingRequest,
  ) {
    return this.dailyCodeReviewService.generateProjectDailyCodeReview(id, dto, req.authSession, {
      async: true,
    });
  }

  @Get('daily-code-reviews/:id')
  getDailyCodeReview(@Param('id') id: string) {
    return this.dailyCodeReviewService.getDailyCodeReview(id);
  }

  @Post('daily-code-reviews/:id/send')
  sendDailyCodeReview(@Param('id') id: string) {
    return this.dailyCodeReviewService.sendDailyCodeReview(id);
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
