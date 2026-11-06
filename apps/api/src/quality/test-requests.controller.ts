import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { AddTestScopeCasesDto, AssignTestRequestCasesDto, CompleteTestScopeDto, CreateTestRequestDto, PrepareTestRequestDto, SaveGeneratedTestCaseDto, UpdateTestRequestScopeDraftDto } from './dto/test-request.dto';
import { TestRequestsService } from './test-requests.service';

@Controller('quality/test-requests')
export class TestRequestsController {
  constructor(private readonly requests: TestRequestsService) {}

  @Post()
  create(@Body() dto: CreateTestRequestDto, @Req() req: QualityRequest) {
    return this.requests.createRequest(dto, req.authSession?.user.id);
  }

  @Get()
  list(@Query() query: import('../common/pagination').PaginationQuery & { projectId?: string; projectVersionId?: string; status?: string; q?: string }) {
    return this.requests.listRequests(query);
  }

  @Get(':id')
  get(@Param('id') id: string) { return this.requests.getRequestBrowse(id); }

  @Get(':id/snapshots')
  snapshots(@Param('id') id: string, @Query() query: import('../common/pagination').PaginationQuery & { q?: string; kind?: string }) { return this.requests.listSnapshots(id, query); }
  @Get(':id/requirements')
  requirements(@Param('id') id: string, @Query() query: import('../common/pagination').PaginationQuery) { return this.requests.listLinks(id, 'requirements', query); }
  @Get(':id/workflows')
  workflows(@Param('id') id: string, @Query() query: import('../common/pagination').PaginationQuery) { return this.requests.listLinks(id, 'workflows', query); }
  @Get(':id/artifacts')
  artifacts(@Param('id') id: string, @Query() query: import('../common/pagination').PaginationQuery) { return this.requests.listLinks(id, 'artifacts', query); }

  @Get(':id/report-baselines')
  reportBaselines(@Param('id') id: string, @Query() query: import('./test-request-browse').ReportBrowseQuery) { return this.requests.reportBaselines(id, query); }
  @Get(':id/report-supersessions')
  reportSupersessions(@Param('id') id: string, @Query() query: import('./test-request-browse').ReportBrowseQuery) { return this.requests.reportSupersessions(id, query); }
  @Get(':id/cases')
  cases(@Param('id') id: string, @Query() query: import('../common/pagination').PaginationQuery & { q?: string; result?: string; selectedRunIds?: string | string[] }) { return this.requests.listCases(id, query); }

  @Post(':id/prepare')
  prepare(@Param('id') id: string, @Body() dto: PrepareTestRequestDto) {
    return this.requests.prepare(id, dto);
  }

  @Get(':id/scope-draft')
  scopeDraft(@Param('id') id: string, @Query() query: import('../common/pagination').PaginationQuery & { q?: string; action?: string }) {
    return this.requests.getScopeDraft(id, query);
  }

  @Patch(':id/scope-draft')
  updateScopeDraft(@Param('id') id: string, @Body() dto: UpdateTestRequestScopeDraftDto) {
    return this.requests.updateScopeDraft(id, dto);
  }

  @Post(':id/scope-draft/:candidateId/save-to-library')
  saveGeneratedCase(
    @Param('id') id: string,
    @Param('candidateId') candidateId: string,
    @Body() dto: SaveGeneratedTestCaseDto,
    @Req() req: QualityRequest,
  ) {
    return this.requests.saveGeneratedCaseToLibrary(id, candidateId, dto, req.authSession?.user.id);
  }

  @Get(':id/assignments')
  assignments(@Param('id') id: string, @Query() query: import('../common/pagination').PaginationQuery & { q?: string; unassigned?: string }) {
    return this.requests.listAssignments(id, query);
  }

  @Patch(':id/assignments')
  updateAssignments(@Param('id') id: string, @Body() dto: AssignTestRequestCasesDto, @Req() req: QualityRequest) {
    return this.requests.updateAssignments(id, dto, req.authSession?.user.id);
  }

  @Post(':id/assignments/complete')
  completeAssignments(@Param('id') id: string, @Body() dto: PrepareTestRequestDto, @Req() req: QualityRequest) {
    return this.requests.completeAssignments(id, dto.scopeRevision, req.authSession?.user.id);
  }

  @Post(':id/scope/cases')
  addScopeCases(
    @Param('id') id: string,
    @Body() dto: AddTestScopeCasesDto,
    @Req() req: QualityRequest,
  ) {
    return this.requests.addScopeCases(id, dto, req.authSession?.user.id);
  }

  @Post(':id/scope/complete')
  completeScope(@Param('id') id: string, @Body() dto: CompleteTestScopeDto) {
    return this.requests.completeScope(id, dto);
  }
}

type QualityRequest = { authSession?: { user: { id: string } } };
