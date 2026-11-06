import type { PaginationQuery } from '../common/pagination';
import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateProjectDto } from './dto/create-project.dto';
import { CreateProjectVersionDto } from './dto/create-project-version.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateProjectVersionDto } from './dto/update-project-version.dto';
import { ProjectVersionsService } from './project-versions.service';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectVersionsService: ProjectVersionsService,
  ) {}

  @Post()
  create(@Body() dto: CreateProjectDto) {
    return this.projectsService.create(dto);
  }

  @Get()
  findAll(@Query() query: PaginationQuery & { workspaceId?: string; projectId?: string; versionId?: string; planningStatus?: string; priority?: string; status?: string; q?: string } = {}) {
    return this.projectsService.findPage(query);
  }

  @Get(':id/versions')
  listVersions(@Param('id') id: string, @Query() query: PaginationQuery & { q?: string } = {}) {
    return this.projectVersionsService.listPage(id, query);
  }

  @Get(':id/versions/:versionId')
  getVersion(@Param('id') id: string, @Param('versionId') versionId: string) {
    return this.projectVersionsService.findVersion(id, versionId);
  }

  @Post(':id/versions')
  createVersion(@Param('id') id: string, @Body() dto: CreateProjectVersionDto) {
    return this.projectVersionsService.create(id, dto);
  }

  @Patch(':id/versions/:versionId')
  updateVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() dto: UpdateProjectVersionDto,
  ) {
    return this.projectVersionsService.update(id, versionId, dto);
  }

  @Delete(':id/versions/:versionId')
  removeVersion(@Param('id') id: string, @Param('versionId') versionId: string) {
    return this.projectVersionsService.remove(id, versionId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    if (!Object.prototype.hasOwnProperty.call(dto, 'currentVersionId')) {
      throw new BadRequestException('currentVersionId is required.');
    }
    return this.projectVersionsService.setCurrentVersion(id, dto.currentVersionId ?? null);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.projectsService.findDetail(id);
  }
}
