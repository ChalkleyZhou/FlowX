import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { CreateTestRunDto, ReportTestResultDto } from './dto/test-run.dto';
import { TestRunsService } from './test-runs.service';

@Controller('quality')
export class TestRunsController {
  constructor(private readonly runs: TestRunsService) {}

  @Get('test-requests/:testRequestId/runs')
  list(@Param('testRequestId') testRequestId: string) {
    return this.runs.listRuns(testRequestId);
  }

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
