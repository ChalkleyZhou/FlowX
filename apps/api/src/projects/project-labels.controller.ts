import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ProjectLabelsService } from './project-labels.service';
import { CreateProjectLabelDto, UpdateProjectLabelDto } from './dto/project-label.dto';
import type { PaginationQuery } from '../common/pagination';
type Request = { authSession?: { organization?: { id?: string | null } | null } };
@Controller('projects/:projectId/labels')
export class ProjectLabelsController {
  constructor(private readonly labels: ProjectLabelsService) {}
  @Get() list(@Param('projectId') projectId: string, @Query() query: PaginationQuery & { q?: string }, @Req() req: Request) { return this.labels.listPage(projectId, query, req.authSession); }
  @Post() create(@Param('projectId') projectId: string, @Body() dto: CreateProjectLabelDto, @Req() req: Request) { return this.labels.create(projectId, dto, req.authSession); }
  @Patch(':labelId') update(@Param('projectId') projectId: string, @Param('labelId') labelId: string, @Body() dto: UpdateProjectLabelDto, @Req() req: Request) { return this.labels.update(projectId, labelId, dto, req.authSession); }
  @Delete(':labelId') remove(@Param('projectId') projectId: string, @Param('labelId') labelId: string, @Req() req: Request) { return this.labels.remove(projectId, labelId, req.authSession); }
}
