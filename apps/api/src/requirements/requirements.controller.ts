import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Req, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import {
  ReviseBrainstormDto,
  ReviseDesignDto,
  StartBrainstormDto,
  StartDesignDto,
} from './dto/ideation.dto';
import { UpdateRequirementDto } from './dto/update-requirement.dto';
import { UpsertRequirementAssignmentDto } from './dto/upsert-requirement-assignment.dto';
import { RequirementAssignmentsService } from './requirement-assignments.service';
import { RequirementChangesService } from './requirement-changes.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreatePrototypeRequirementChangeDto, CreateRequirementChangeDto } from './dto/create-requirement-change.dto';
import { RequirementsService } from './requirements.service';

@Controller('requirements')
export class RequirementsController {
  constructor(
    private readonly requirementsService: RequirementsService,
    private readonly requirementAssignmentsService: RequirementAssignmentsService,
    private readonly requirementChangesService: RequirementChangesService,
  ) {}

  @Post()
  create(@Body() dto: CreateRequirementDto, @Req() req: RequirementsRequest) {
    return this.requirementsService.create(dto, req.authSession);
  }

  @Get()
  findAll() {
    return this.requirementsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.requirementsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRequirementDto) {
    return this.requirementsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.requirementsService.remove(id);
  }

  @Get(':id/changes')
  listChanges(@Param('id') id: string, @Query('workflowRunId') workflowRunId: string | undefined, @Req() req: RequirementsRequest) {
    if (!req.authSession) throw new ForbiddenException('请登录后查看需求变更。');
    return this.requirementChangesService.list(id, workflowRunId, req.authSession);
  }

  @Post(':id/changes')
  createChange(@Param('id') id: string, @Body() dto: CreateRequirementChangeDto, @Req() req: RequirementsRequest) {
    return this.requirementChangesService.create(id, dto, req.authSession);
  }

  @Post(':id/changes/prototype')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 5, fieldSize: 20000 } }))
  createPrototypeChange(@Param('id') id: string, @Body() dto: CreatePrototypeRequirementChangeDto,
    @UploadedFile() uploaded: { buffer: Buffer; originalname: string } | undefined, @Req() req: RequirementsRequest) {
    if (!uploaded?.buffer?.length) throw new BadRequestException('请选择原型 ZIP 包。');
    const original = /[\u0080-\u00ff]/.test(uploaded.originalname) ? Buffer.from(uploaded.originalname, 'latin1').toString('utf8') : uploaded.originalname;
    const name = original.replace(/[\\/\r\n]/g, '_').slice(0, 200);
    return this.requirementChangesService.createWithPrototype(id, dto, uploaded.buffer, name, req.authSession);
  }

  @Get(':id/changes/:changeId/source')
  async downloadChangePrototype(@Param('id') id: string, @Param('changeId') changeId: string, @Req() req: RequirementsRequest) {
    const buffer = await this.requirementChangesService.downloadPrototype(id, changeId, req.authSession);
    return new StreamableFile(buffer, { type: 'application/zip', disposition: 'attachment; filename="prototype.zip"', length: buffer.length });
  }

  @Post(':id/changes/:changeId/restart')
  restartChange(@Param('id') id: string, @Param('changeId') changeId: string, @Req() req: RequirementsRequest) {
    if (!req.authSession) throw new ForbiddenException('请登录后继续启动流程。');
    return this.requirementChangesService.restart(id, changeId, req.authSession);
  }

  @Get(':id/assignments')
  listAssignments(@Param('id') id: string) {
    return this.requirementAssignmentsService.list(id);
  }

  @Post(':id/assignments')
  createAssignment(@Param('id') id: string, @Body() dto: UpsertRequirementAssignmentDto) {
    return this.requirementAssignmentsService.create(id, dto);
  }

  @Patch(':id/assignments/:assignmentId')
  updateAssignment(
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
    @Body() dto: UpsertRequirementAssignmentDto,
  ) {
    return this.requirementAssignmentsService.update(id, assignmentId, dto);
  }

  @Delete(':id/assignments/:assignmentId')
  removeAssignment(@Param('id') id: string, @Param('assignmentId') assignmentId: string) {
    return this.requirementAssignmentsService.remove(id, assignmentId);
  }

  // ── Ideation endpoints ──

  @Post(':id/brainstorm/run')
  startBrainstorm(@Param('id') id: string, @Body() dto: StartBrainstormDto, @Req() req: RequirementsRequest) {
    return this.requirementsService.startBrainstorm(id, dto.humanHint, req.authSession);
  }

  @Post(':id/brainstorm/revise')
  reviseBrainstorm(@Param('id') id: string, @Body() dto: ReviseBrainstormDto, @Req() req: RequirementsRequest) {
    return this.requirementsService.reviseBrainstorm(id, dto.feedback, req.authSession);
  }

  @Post(':id/brainstorm/confirm')
  confirmBrainstorm(@Param('id') id: string) {
    return this.requirementsService.confirmBrainstorm(id);
  }

  @Post(':id/design/run')
  startDesign(@Param('id') id: string, @Body() dto: StartDesignDto, @Req() req: RequirementsRequest) {
    return this.requirementsService.startDesign(id, dto.humanHint, req.authSession);
  }

  @Post(':id/design/revise')
  reviseDesign(@Param('id') id: string, @Body() dto: ReviseDesignDto, @Req() req: RequirementsRequest) {
    return this.requirementsService.reviseDesign(id, dto.feedback, req.authSession);
  }

  @Post(':id/design/confirm')
  confirmDesign(@Param('id') id: string) {
    return this.requirementsService.confirmDesign(id);
  }

  @Get(':id/ideation/sessions/:sessionId/events')
  getIdeationSessionEvents(@Param('id') id: string, @Param('sessionId') sessionId: string) {
    return this.requirementsService.getIdeationSessionEvents(id, sessionId);
  }

  @Post(':id/ideation/finalize')
  finalizeIdeation(@Param('id') id: string) {
    return this.requirementsService.finalizeIdeation(id);
  }
}

type RequirementsRequest = {
  authSession?: {
    user: {
      id: string;
      displayName: string;
    };
    organization?: {
      id?: string | null;
      providerOrganizationId?: string | null;
      name?: string | null;
    } | null;
  };
};
