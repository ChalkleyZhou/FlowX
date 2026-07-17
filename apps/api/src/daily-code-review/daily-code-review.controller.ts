import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { CodeReviewConfigService } from './code-review-config.service';
import { DailyCodeReviewService } from './daily-code-review.service';
import { GenerateDailyCodeReviewDto } from './dto/generate-daily-code-review.dto';
import { UpsertCodeReviewConfigDto } from './dto/upsert-code-review-config.dto';

@Controller()
export class DailyCodeReviewController {
  constructor(
    private readonly dailyCodeReviewService: DailyCodeReviewService,
    private readonly codeReviewConfigService: CodeReviewConfigService,
  ) {}

  @Get('projects/:id/code-review-config')
  getProjectCodeReviewConfig(@Param('id') id: string) {
    return this.codeReviewConfigService.getProjectConfig(id);
  }

  @Put('projects/:id/code-review-config')
  updateProjectCodeReviewConfig(@Param('id') id: string, @Body() dto: UpsertCodeReviewConfigDto) {
    return this.codeReviewConfigService.upsertProjectConfig(id, dto);
  }

  @Get('projects/:id/daily-code-reviews')
  listProjectDailyCodeReviews(@Param('id') id: string) {
    return this.dailyCodeReviewService.listProjectDailyCodeReviews(id);
  }

  @Post('projects/:id/daily-code-reviews/generate')
  generateProjectDailyCodeReview(
    @Param('id') id: string,
    @Body() dto: GenerateDailyCodeReviewDto,
    @Req() req: DailyCodeReviewRequest,
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

type DailyCodeReviewRequest = {
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
