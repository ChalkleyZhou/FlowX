import { ProjectLabelsController } from './project-labels.controller';
import { ProjectLabelsService } from './project-labels.service';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectVersionsService } from './project-versions.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProjectLabelsController, ProjectsController],
  providers: [ProjectLabelsService, ProjectsService, ProjectVersionsService],
  exports: [ProjectLabelsService, ProjectsService, ProjectVersionsService],
})
export class ProjectsModule {}
