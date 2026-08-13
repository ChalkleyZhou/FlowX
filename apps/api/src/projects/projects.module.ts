import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectVersionsService } from './project-versions.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectVersionsService],
  exports: [ProjectsService, ProjectVersionsService],
})
export class ProjectsModule {}
