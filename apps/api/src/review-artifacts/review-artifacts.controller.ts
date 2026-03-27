import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ConvertToBugDto } from './dto/convert-to-bug.dto';
import { ConvertToIssueDto } from './dto/convert-to-issue.dto';
import { UpdateBugDto } from './dto/update-bug.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { UpdateReviewFindingDto } from './dto/update-review-finding.dto';
import { ReviewArtifactsService } from './review-artifacts.service';

@Controller()
export class ReviewArtifactsController {
  constructor(private readonly reviewArtifactsService: ReviewArtifactsService) {}

  @Get('workflow-runs/:workflowRunId/review-findings')
  getWorkflowRunReviewFindings(@Param('workflowRunId') workflowRunId: string) {
    return this.reviewArtifactsService.getWorkflowRunReviewFindings(workflowRunId);
  }

  @Post('review-reports/:reviewReportId/findings/sync')
  syncReviewFindings(@Param('reviewReportId') reviewReportId: string) {
    return this.reviewArtifactsService.syncReviewFindings(reviewReportId);
  }

  @Patch('review-findings/:id')
  updateReviewFinding(@Param('id') id: string, @Body() dto: UpdateReviewFindingDto) {
    return this.reviewArtifactsService.updateReviewFinding(id, dto);
  }

  @Post('review-findings/:id/accept')
  acceptReviewFinding(@Param('id') id: string) {
    return this.reviewArtifactsService.acceptReviewFinding(id);
  }

  @Post('review-findings/:id/dismiss')
  dismissReviewFinding(@Param('id') id: string) {
    return this.reviewArtifactsService.dismissReviewFinding(id);
  }

  @Post('review-findings/:id/convert-to-issue')
  convertToIssue(
    @Param('id') id: string,
    @Body() dto: ConvertToIssueDto,
    @Req() request: { user?: { id?: string } },
  ) {
    return this.reviewArtifactsService.convertReviewFindingToIssue(id, dto, request.user?.id ?? null);
  }

  @Post('review-findings/:id/convert-to-bug')
  convertToBug(
    @Param('id') id: string,
    @Body() dto: ConvertToBugDto,
    @Req() request: { user?: { id?: string } },
  ) {
    return this.reviewArtifactsService.convertReviewFindingToBug(id, dto, request.user?.id ?? null);
  }

  @Get('issues')
  getIssues(
    @Query('workspaceId') workspaceId?: string,
    @Query('workflowRunId') workflowRunId?: string,
    @Query('status') status?: string,
  ) {
    return this.reviewArtifactsService.getIssues({ workspaceId, workflowRunId, status });
  }

  @Get('issues/:id')
  getIssue(@Param('id') id: string) {
    return this.reviewArtifactsService.getIssue(id);
  }

  @Patch('issues/:id')
  updateIssue(@Param('id') id: string, @Body() dto: UpdateIssueDto) {
    return this.reviewArtifactsService.updateIssue(id, dto);
  }

  @Get('bugs')
  getBugs(
    @Query('workspaceId') workspaceId?: string,
    @Query('workflowRunId') workflowRunId?: string,
    @Query('status') status?: string,
  ) {
    return this.reviewArtifactsService.getBugs({ workspaceId, workflowRunId, status });
  }

  @Get('bugs/:id')
  getBug(@Param('id') id: string) {
    return this.reviewArtifactsService.getBug(id);
  }

  @Patch('bugs/:id')
  updateBug(@Param('id') id: string, @Body() dto: UpdateBugDto) {
    return this.reviewArtifactsService.updateBug(id, dto);
  }
}
