import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
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
  findAll() {
    return this.projectsService.findAll();
  }

  @Get(':id/versions')
  listVersions(@Param('id') id: string) {
    return this.projectVersionsService.list(id);
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
    return this.projectsService.findOne(id);
  }
}
