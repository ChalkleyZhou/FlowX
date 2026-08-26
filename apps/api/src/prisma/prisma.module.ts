import { Global, Module } from '@nestjs/common';
import { OrganizationContextService } from './organization-context.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [OrganizationContextService, PrismaService],
  exports: [OrganizationContextService, PrismaService],
})
export class PrismaModule {}
