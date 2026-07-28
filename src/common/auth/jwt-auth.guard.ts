import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // ApiKeyGuard runs first and populates request.user for service callers.
    // Those requests carry no bearer token, so passport would reject them.
    const request = context.switchToHttp().getRequest<{ apiKeyAuth?: boolean }>();
    if (request.apiKeyAuth) return true;

    return super.canActivate(context);
  }
}
