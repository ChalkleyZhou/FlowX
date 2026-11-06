import type { PaginationQuery } from '../common/pagination';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { CodeReviewFeedsService } from './code-review-feeds.service';
import { DailyCodeReviewService } from './daily-code-review.service';
import { CreateCodeReviewFeedDto, UpdateCodeReviewFeedDto } from './dto/code-review-feed.dto';
import { GenerateDailyCodeReviewDto } from './dto/generate-daily-code-review.dto';

@Controller()
export class DailyCodeReviewController {
  constructor(
    private readonly dailyCodeReviewService: DailyCodeReviewService,
    private readonly codeReviewFeedsService: CodeReviewFeedsService,
  ) {}

  @Get('projects/:id/code-review-feeds')
  listFeeds(@Param('id') id: string, @Query() query: PaginationQuery & {q?:string} = {}) {
    return this.codeReviewFeedsService.listFeedsPage(id, query);
  }

  @Post('projects/:id/code-review-feeds')
  createFeed(@Param('id') id: string, @Body() dto: CreateCodeReviewFeedDto) {
    return this.codeReviewFeedsService.createFeed(id, dto);
  }

  @Get('code-review-feeds/:id')
  getFeed(@Param('id') id: string) {
    return this.codeReviewFeedsService.getFeed(id);
  }

  @Patch('code-review-feeds/:id')
  updateFeed(@Param('id') id: string, @Body() dto: UpdateCodeReviewFeedDto) {
    return this.codeReviewFeedsService.updateFeed(id, dto);
  }

  @Delete('code-review-feeds/:id')
  deleteFeed(@Param('id') id: string) {
    return this.codeReviewFeedsService.deleteFeed(id);
  }

  @Get('projects/:id/daily-code-reviews')
  listProjectDailyCodeReviews(@Param('id') id: string, @Query() query: PaginationQuery = {}) {
    return this.dailyCodeReviewService.listProjectDailyCodeReviewsPage(id, query);
  }

  @Post('code-review-feeds/:id/generate')
  generateFeedDailyCodeReview(
    @Param('id') id: string,
    @Body() dto: GenerateDailyCodeReviewDto,
    @Req() req: DailyCodeReviewRequest,
  ) {
    return this.dailyCodeReviewService.generateFeedDailyCodeReview(id, dto, req.authSession, {
      async: true,
    });
  }

  @Get('daily-code-reviews/:id/delivery-logs')
  listDeliveryLogs(@Param('id') id: string, @Query() query: PaginationQuery = {}) { return this.dailyCodeReviewService.listDeliveryLogs(id, query); }

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
