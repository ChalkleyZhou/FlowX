import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { AddTestScopeCasesDto, CompleteTestScopeDto, CreateTestRequestDto } from './dto/test-request.dto';
import { TestRequestsService } from './test-requests.service';

@Controller('quality/test-requests')
export class TestRequestsController {
  constructor(private readonly requests: TestRequestsService) {}

  @Post()
  create(@Body() dto: CreateTestRequestDto, @Req() req: QualityRequest) {
    return this.requests.createRequest(dto, req.authSession?.user.id);
  }

  @Get()
  list(
    @Query('projectId') projectId?: string,
    @Query('projectVersionId') projectVersionId?: string,
    @Query('status') status?: string,
  ) {
    return this.requests.listRequests({ projectId, projectVersionId, status });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.requests.getRequest(id);
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
