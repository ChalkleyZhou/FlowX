import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { DeployController } from './deploy.controller';
import { DeployService } from './deploy.service';
import { NoopDeployProvider } from './providers/noop-deploy.provider';
import { DeployProviderRegistryService } from './providers/provider-registry.service';
import { RokidOpsDeployProvider } from './providers/rokid-ops-deploy.provider';

@Module({
  imports: [ConfigModule, PrismaModule, WorkspacesModule],
  controllers: [DeployController],
  providers: [
    DeployService,
    NoopDeployProvider,
    RokidOpsDeployProvider,
    DeployProviderRegistryService,
  ],
  exports: [DeployService, DeployProviderRegistryService],
})
export class DeployModule {}
