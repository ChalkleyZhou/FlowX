import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RepositorySyncRecoveryService } from './repository-sync-recovery.service';
import { RepositorySyncService } from './repository-sync.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [PrismaModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, RepositorySyncService, RepositorySyncRecoveryService],
  exports: [WorkspacesService, RepositorySyncService],
})
export class WorkspacesModule {}
