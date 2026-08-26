import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { OrganizationContextService } from './organization-context.service';

type AuthenticatedRequest = {
  authSession?: {
    organization?: {
      id?: string | null;
    } | null;
  };
};

@Injectable()
export class OrganizationScopeInterceptor implements NestInterceptor {
  constructor(private readonly organizationContext: OrganizationContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.authSession) {
      return next.handle();
    }

    const organizationId = request.authSession.organization?.id?.trim() || null;
    return new Observable((subscriber) =>
      this.organizationContext.run({ organizationId }, () =>
        next.handle().subscribe(subscriber),
      ),
    );
  }
}
