import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ApiKeyService } from './api-key.service';
import { Role } from './roles.enum';

export interface ApiKeyAuthenticatedRequest extends Request {
  user?: { userId: string; did: string; role: string };
  apiKeyAuth?: boolean;
}

/**
 * Authenticates service-to-service callers by API key.
 *
 * Never rejects on its own: a missing or wrong key simply leaves the request
 * unauthenticated and JwtAuthGuard decides. Rejecting here would break every
 * ordinary bearer-token request, since those carry no API key at all.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeyService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.apiKeys.enabled) return true;

    const request = context.switchToHttp().getRequest<ApiKeyAuthenticatedRequest>();
    const presented = request.headers[this.apiKeys.header];
    const value = Array.isArray(presented) ? presented[0] : presented;

    const identity = this.apiKeys.verify(value);
    if (identity) {
      request.user = {
        userId: `service:${identity.label}`,
        did: `did:prom:service-${identity.label}`,
        role: Role.SERVICE,
      };
      request.apiKeyAuth = true;
    }

    return true;
  }
}
