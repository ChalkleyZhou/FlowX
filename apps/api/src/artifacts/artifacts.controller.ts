import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { ArtifactType } from '@flowx-ai/protocol';
import { ArtifactsService } from './artifacts.service';
import { RegisterArtifactDto } from './dto/register-artifact.dto';
import { RegisterEvidenceDto } from './dto/register-evidence.dto';
import { CreateArtifactUploadDto } from './dto/create-artifact-upload.dto';
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

  @Post('execution-sessions/:id/artifact-uploads')
  createArtifactUpload(
    @Param('id') id: string,
    @Body() dto: CreateArtifactUploadDto,
    @Req() req: ArtifactRequest,
  ) {
    return this.artifactsService.createManagedUpload(id, dto, toScope(req));
  }

  @Put('artifacts/:id/content')
  uploadArtifactContent(
    @Param('id') id: string,
    @Req() req: ArtifactRequest & { rawBody?: Buffer },
  ) {
    const content = req.rawBody;
    if (!Buffer.isBuffer(content)) {
      throw new BadRequestException('Artifact content must use application/octet-stream.');
    }
    return this.artifactsService.writeManagedContent(id, content, toScope(req));
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

  @Get('artifacts/:id/content')
  async readArtifactContent(
    @Param('id') id: string,
    @Req() req: ArtifactRequest,
    @Res() res: ArtifactResponse,
  ) {
    const { artifact, content } = await this.artifactsService.readLocalContent(id, toScope(req));
    res.type(artifact.mimeType || 'application/octet-stream');
    res.setHeader('content-length', String(content.byteLength));
    res.setHeader('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(artifact.name)}`);
    res.send(content);
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

type ArtifactResponse = {
  type(contentType: string): ArtifactResponse;
  setHeader(name: string, value: string): void;
  send(content: Buffer): void;
};

function toScope(req: ArtifactRequest) {
  return {
    userId: req.authSession?.user?.id ?? null,
    organizationId: req.authSession?.organization?.id ?? null,
  };
}
