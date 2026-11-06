import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { CreateTestRunDto, ReportTestResultDto } from './dto/test-run.dto';
import { TestRunsService } from './test-runs.service';

@Controller('quality')
export class TestRunsController {
  constructor(private readonly runs: TestRunsService) {}

  @Get('test-runs')
  all(@Query() query: import('../common/pagination').PaginationQuery & { projectId?: string; projectVersionId?: string; testRequestId?: string; status?: string; runType?: string; q?: string }) { return this.runs.listAllRuns(query); }

  @Get('test-requests/:testRequestId/runs')
  list(@Param('testRequestId') testRequestId: string, @Query() query: import('../common/pagination').PaginationQuery & { q?: string; status?: string }) { return this.runs.listRuns(testRequestId, query); }
  @Get('test-runs/:id/cases')
  cases(@Param('id') id: string, @Query() query: import('../common/pagination').PaginationQuery & { q?: string; result?: string; targetId?: string; bugId?: string }) { return this.runs.listCases(id, query); }
  @Get('test-runs/:id/targets')
  targets(@Param('id') id: string, @Query() query: import('../common/pagination').PaginationQuery) { return this.runs.listTargets(id, query); }
  @Get('test-runs/:id/executions')
  executions(@Param('id') id: string, @Query() query: import('../common/pagination').PaginationQuery) { return this.runs.listExecutions(id, query); }

  @Post('test-requests/:testRequestId/runs')
  create(
    @Param('testRequestId') testRequestId: string,
    @Body() dto: CreateTestRunDto,
    @Req() req: QualityRequest,
  ) {
    return this.runs.createRun(testRequestId, dto, req.authSession?.user.id);
  }

  @Post('test-run-cases/:testRunCaseId/result')
  reportResult(
    @Param('testRunCaseId') testRunCaseId: string,
    @Body() dto: ReportTestResultDto,
    @Req() req: QualityRequest,
  ) {
    return this.runs.reportResult(testRunCaseId, dto, req.authSession?.user.id);
  }
}

type QualityRequest = { authSession?: { user: { id: string } } };
