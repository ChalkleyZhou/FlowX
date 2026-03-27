import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateRepositoryDto } from './dto/create-repository.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateRepositoryBranchDto } from './dto/update-repository-branch.dto';
import { WorkspacesService } from './workspaces.service';

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  create(@Body() dto: CreateWorkspaceDto) {
    return this.workspacesService.create(dto);
  }

  @Get()
  findAll() {
    return this.workspacesService.findAll();
  }

  @Post(':id/repositories')
  addRepository(@Param('id') id: string, @Body() dto: CreateRepositoryDto) {
    return this.workspacesService.addRepository(id, dto);
  }

  @Patch(':workspaceId/repositories/:repositoryId/branch')
  updateRepositoryBranch(
    @Param('workspaceId') workspaceId: string,
    @Param('repositoryId') repositoryId: string,
    @Body() dto: UpdateRepositoryBranchDto,
  ) {
    return this.workspacesService.updateRepositoryBranch(workspaceId, repositoryId, dto);
  }
}
