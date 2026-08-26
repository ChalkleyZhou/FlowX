import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { OrganizationContextService } from './organization-context.service';
import { OrganizationScopeInterceptor } from './organization-scope.interceptor';

describe('OrganizationScopeInterceptor', () => {
  it('keeps the authenticated organization available through async request work', async () => {
    const organizationContext = new OrganizationContextService();
    const interceptor = new OrganizationScopeInterceptor(organizationContext);
    const executionContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          authSession: { organization: { id: ' org-current ' } },
        }),
      }),
    } as unknown as ExecutionContext;
    const next = {
      handle: () => new Observable((subscriber) => {
        queueMicrotask(() => {
          subscriber.next(organizationContext.getScope());
          subscriber.complete();
        });
      }),
    } as CallHandler;

    await expect(firstValueFrom(interceptor.intercept(executionContext, next))).resolves.toEqual({
      organizationId: 'org-current',
    });
  });
});
