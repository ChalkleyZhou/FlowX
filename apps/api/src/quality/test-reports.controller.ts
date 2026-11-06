import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { CreateRequestTestReportDto, CreateRunTestReportDto } from './dto/test-report.dto';
import { TestReportsService } from './test-reports.service';
@Controller('quality')
export class TestReportsController {
  constructor(private readonly reports: TestReportsService) {}
  @Get('test-requests/:id/reports') list(@Param('id') id: string, @Query() query: import('../common/pagination').PaginationQuery) { return this.reports.list(id, query); }
  @Post('test-runs/:id/reports') run(@Param('id') id: string, @Body() dto: CreateRunTestReportDto, @Req() req: QualityRequest) { return this.reports.createRunReport(id, dto, req.authSession?.user.id); }
  @Post('test-requests/:id/reports') request(@Param('id') id: string, @Body() dto: CreateRequestTestReportDto, @Req() req: QualityRequest) { return this.reports.createRequestReport(id, dto, req.authSession?.user.id); }
}
type QualityRequest = { authSession?: { user: { id: string } } };
