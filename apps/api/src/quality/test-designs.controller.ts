import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ConfirmTestDesignDto,
  UpdateQualitySelectionDto,
  AddQualityCandidatesDto,
  CreateTestDesignDto,
  UpdateTestDesignCandidateDto,
  UpdateTestDesignSmokeDto,
} from './dto/test-design.dto';
import { TestDesignsService } from './test-designs.service';

@Controller('quality/test-designs')
export class TestDesignsController {
  constructor(private readonly designs: TestDesignsService) {}

  @Post()
  create(@Body() dto: CreateTestDesignDto) {
    return this.designs.createDesign(dto);
  }

  @Get()
  list(@Query() query: import('../common/pagination').PaginationQuery & { requirementId?: string; projectId?: string; projectVersionId?: string; status?: string; q?: string; availableForRequest?: string | boolean; workflowRunIds?: string | string[] }) { return this.designs.listDesigns(query); }

  @Get(':id')
  get(@Param('id') id: string) { return this.designs.getDesignBrowse(id); }
  @Get(':id/candidates')
  candidates(@Param('id') id: string, @Query() query: import('../common/pagination').PaginationQuery & { q?: string; resolution?: string }) { return this.designs.listCandidates(id, query); }
  @Get(':id/smoke-cases')
  smokeCases(@Param('id') id: string, @Query() query: import('../common/pagination').PaginationQuery & { q?: string }) { return this.designs.listSmokeCases(id, query); }
  @Get(':id/requirements')
  requirements(@Param('id') id: string, @Query() query: import('../common/pagination').PaginationQuery) { return this.designs.listLinks(id, 'requirements', query); }
  @Get(':id/workflows')
  workflows(@Param('id') id: string, @Query() query: import('../common/pagination').PaginationQuery) { return this.designs.listLinks(id, 'workflows', query); }

  @Post(':id/generate')
  generate(@Param('id') id: string, @Req() req: QualityRequest) {
    const session = req.authSession;
    return this.designs.generate(id, session?.user ? {
      flowxUserId: session.user.id,
      flowxOrganizationId: session.organization?.id ?? null,
      displayName: session.user.displayName ?? '',
    } : null);
  }

  @Patch(':id/selection')
  updateSelection(@Param('id') id: string, @Body() dto: UpdateQualitySelectionDto) {
    return this.designs.updateSelection(id, dto);
  }

  @Post(':id/candidates')
  addCandidates(@Param('id') id: string, @Body() dto: AddQualityCandidatesDto) {
    return this.designs.addCandidates(id, dto);
  }

  @Patch(':id/candidates/:candidateId')
  updateCandidate(@Param('id') id: string, @Param('candidateId') candidateId: string, @Body() dto: UpdateTestDesignCandidateDto) {
    return this.designs.updateCandidate(id, candidateId, dto);
  }

  @Patch(':id/smoke')
  updateSmoke(@Param('id') id: string, @Body() dto: UpdateTestDesignSmokeDto) {
    return this.designs.updateSmoke(id, dto);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Body() dto: ConfirmTestDesignDto, @Req() req: QualityRequest) {
    return this.designs.confirm(id, dto, req.authSession?.user.id);
  }
}

type QualityRequest = {
  authSession?: {
    user: { id: string; displayName?: string };
    organization?: { id?: string | null } | null;
  };
};
