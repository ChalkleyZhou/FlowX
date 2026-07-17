import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { DailyCodeReviewService } from './daily-code-review.service';
import { GenerateDailyCodeReviewDto } from './dto/generate-daily-code-review.dto';

@Controller()
export class DailyCodeReviewController {
  constructor(private readonly dailyCodeReviewService: DailyCodeReviewService) {}

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
