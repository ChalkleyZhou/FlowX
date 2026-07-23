import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { ArtifactType } from '@flowx-ai/protocol';
import { ArtifactsService } from './artifacts.service';
import { RegisterArtifactDto } from './dto/register-artifact.dto';
import { RegisterEvidenceDto } from './dto/register-evidence.dto';
import { EvidenceService } from './evidence.service';

@Controller()
export class ArtifactsController {
  constructor(
    private readonly artifactsService: ArtifactsService,
    private readonly evidenceService: EvidenceService,
  ) {}

  @Post('execution-sessions/:id/artifacts')
  registerArtifact(
    @Param('id') id: string,
    @Body() dto: RegisterArtifactDto,
    @Req() req: ArtifactRequest,
  ) {
    return this.artifactsService.registerForSession(id, dto, toScope(req));
  }

  @Get('execution-sessions/:id/artifacts')
  listSessionArtifacts(@Param('id') id: string, @Req() req: ArtifactRequest) {
    return this.artifactsService.list({ executionSessionId: id }, toScope(req));
  }

  @Post('execution-sessions/:id/evidence')
  registerEvidence(
    @Param('id') id: string,
    @Body() dto: RegisterEvidenceDto,
    @Req() req: ArtifactRequest,
  ) {
    return this.evidenceService.register(id, dto, toScope(req));
  }

  @Get('execution-sessions/:id/evidence')
  listEvidence(@Param('id') id: string, @Req() req: ArtifactRequest) {
    return this.evidenceService.list(id, toScope(req));
  }

  @Get('artifacts')
  listArtifacts(
    @Query('workflowRunId') workflowRunId: string | undefined,
    @Query('executionSessionId') executionSessionId: string | undefined,
    @Query('artifactType') artifactType: ArtifactType | undefined,
    @Query('take') rawTake: string | undefined,
    @Req() req: ArtifactRequest,
  ) {
    const take = rawTake ? Number.parseInt(rawTake, 10) : undefined;
    return this.artifactsService.list(
      {
        workflowRunId: workflowRunId?.trim() || undefined,
        executionSessionId: executionSessionId?.trim() || undefined,
        artifactType,
        take: Number.isFinite(take) ? take : undefined,
      },
      toScope(req),
    );
  }

  @Get('artifacts/:id')
  findArtifact(@Param('id') id: string, @Req() req: ArtifactRequest) {
    return this.artifactsService.findOne(id, toScope(req));
  }

  @Delete('artifacts/:id')
  deleteArtifact(@Param('id') id: string, @Req() req: ArtifactRequest) {
    return this.artifactsService.markDeleted(id, toScope(req));
  }
}

type ArtifactRequest = {
  authSession?: {
    user?: { id?: string | null } | null;
    organization?: { id?: string | null } | null;
  };
};

function toScope(req: ArtifactRequest) {
  return {
    userId: req.authSession?.user?.id ?? null,
    organizationId: req.authSession?.organization?.id ?? null,
  };
}
