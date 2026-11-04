import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { QUALITY_CAPABILITIES } from '@flowx-ai/protocol';
import { ClaimLocalSmokeDto } from './dto/local-smoke.dto';
import { CreateLocalTestRunDto, FinishQualityRunDto, LinkQualityBugDto, QualityControlDto, QualityExecutionReportDto } from './dto/local-test-run.dto';
import { LocalTestRunsService } from './local-test-runs.service';
@Controller()
export class LocalTestRunsController {
  constructor(private readonly runs: LocalTestRunsService) {}
  @Get('quality/capabilities') capabilities() { return { capabilities: QUALITY_CAPABILITIES }; }
  @Get('quality/local-test-tasks') tasks(@Query('projectId') projectId?: string, @Query('projectVersionId') projectVersionId?: string, @Query('testRequestId') testRequestId?: string) { return this.runs.listTasks({ projectId, projectVersionId, testRequestId }); }
  @Post('quality/test-requests/:id/local-test-runs') create(@Param('id') id: string, @Body() dto: CreateLocalTestRunDto, @Req() req: QualityRequest) { return this.runs.createTestRun(id, dto, req.authSession?.user.id); }
  @Get('quality/test-runs/:id') get(@Param('id') id: string) { return this.runs.getRun(id); }
  @Get('quality/test-runs/:id/tasks') getTasks(@Param('id') id: string) { return this.runs.getTasks(id); }
  @Post('quality/test-runs/:id/claim') claim(@Param('id') id: string, @Body() dto: ClaimLocalSmokeDto, @Req() req: QualityRequest) { return this.runs.claim(id, dto, req.authSession?.user.id); }
  @Post('quality/test-runs/:id/cases/:caseId/bug') linkBug(@Param('id') id: string, @Param('caseId') caseId: string, @Body() dto: LinkQualityBugDto) { return this.runs.linkBug(id, caseId, dto.bugId); }
  @Post('quality/test-runs/:id/finish') finish(@Param('id') id: string, @Body() dto: FinishQualityRunDto, @Req() req: QualityRequest) { return this.runs.finish(id, dto, req.authSession?.user.id); }
  @Post('execution-sessions/:id/quality/progress') progress(@Param('id') id: string, @Body() dto: QualityExecutionReportDto, @Req() req: QualityRequest) { return this.runs.progress(id, dto, this.scope(req)); }
  @Post('execution-sessions/:id/quality/complete') complete(@Param('id') id: string, @Body() dto: QualityExecutionReportDto, @Req() req: QualityRequest) { return this.runs.completeTest(id, dto, this.scope(req)); }
  @Post('execution-sessions/:id/quality/heartbeat') heartbeat(@Param('id') id: string, @Body() dto: QualityControlDto, @Req() req: QualityRequest) { return this.runs.control(id, 'heartbeat', dto, this.scope(req)); }
  @Post('execution-sessions/:id/quality/release') release(@Param('id') id: string, @Body() dto: QualityControlDto, @Req() req: QualityRequest) { return this.runs.control(id, 'release', dto, this.scope(req)); }
  @Post('execution-sessions/:id/quality/cancel') cancel(@Param('id') id: string, @Body() dto: QualityControlDto, @Req() req: QualityRequest) { return this.runs.control(id, 'cancel', dto, this.scope(req)); }
  private scope(req: QualityRequest) { return { userId: req.authSession?.user.id, organizationId: req.authSession?.organization?.id }; }
}
type QualityRequest = { authSession?: { user: { id: string }; organization?: { id: string } } };
