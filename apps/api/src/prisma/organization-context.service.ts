import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface OrganizationRequestScope {
  organizationId: string | null;
}

@Injectable()
export class OrganizationContextService {
  private readonly storage = new AsyncLocalStorage<OrganizationRequestScope>();

  run<T>(scope: OrganizationRequestScope, callback: () => T): T {
    return this.storage.run(scope, callback);
  }

  getScope(): OrganizationRequestScope | undefined {
    return this.storage.getStore();
  }
}
