import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ConfirmTestDesignDto,
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
  list(@Query('projectId') projectId?: string, @Query('projectVersionId') projectVersionId?: string, @Query('status') status?: string) {
    return this.designs.listDesigns({ projectId, projectVersionId, status });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.designs.getDesign(id);
  }

  @Post(':id/generate')
  generate(@Param('id') id: string) {
    return this.designs.generate(id);
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

type QualityRequest = { authSession?: { user: { id: string } } };
