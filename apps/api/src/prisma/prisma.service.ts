import { ForbiddenException, INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { OrganizationContextService } from './organization-context.service';
import { applyOrganizationScope, isOrganizationScopedModel } from './organization-scope';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor(organizationContext: OrganizationContextService) {
    super();
    return this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const requestScope = organizationContext.getScope();
            if (!requestScope || !isOrganizationScopedModel(model)) {
              return query(args);
            }
            if (!requestScope.organizationId) {
              throw new ForbiddenException('Organization context is required.');
            }
            return query(applyOrganizationScope(model, operation, args, requestScope.organizationId));
          },
        },
      },
    }) as this;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }
}
