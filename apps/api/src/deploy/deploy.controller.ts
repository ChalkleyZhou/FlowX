import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { PreviewDeployJobDto } from './dto/preview-deploy-job.dto';
import { UpdateRepositoryDeployConfigDto } from './dto/update-repository-deploy-config.dto';
import { DeployService } from './deploy.service';

@Controller()
export class DeployController {
  constructor(private readonly deployService: DeployService) {}

  @Get('deploy/providers')
  listProviders() {
    return this.deployService.listProviders();
  }

  @Get('repositories/:id/deploy-config')
  getRepositoryConfig(@Param('id') id: string) {
    return this.deployService.getRepositoryConfig(id);
  }

  @Put('repositories/:id/deploy-config')
  updateRepositoryConfig(@Param('id') id: string, @Body() dto: UpdateRepositoryDeployConfigDto) {
    return this.deployService.upsertRepositoryConfig(id, dto);
  }

  @Post('repositories/:id/deploy/preview')
  preview(@Param('id') id: string, @Body() dto: PreviewDeployJobDto, @Req() req: DeployRequest) {
    return this.deployService.previewJob(id, dto, req.authSession);
  }

  @Post('repositories/:id/deploy/jobs')
  createJob(@Param('id') id: string, @Body() dto: PreviewDeployJobDto, @Req() req: DeployRequest) {
    return this.deployService.createJob(id, dto, req.authSession);
  }

  @Get('repositories/:id/deploy/jobs')
  listJobs(@Param('id') id: string) {
    return this.deployService.listJobs(id);
  }
}

type DeployRequest = {
  authSession?: {
    user?: {
      id?: string;
      displayName?: string;
    };
  };
};
