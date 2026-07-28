import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';

interface AuditEntry {
  timestamp: string;
  requestId: string | null;
  method: string;
  path: string;
  userId: string | null;
  did: string | null;
  role: string | null;
  ip: string;
  userAgent: string;
  statusCode: number;
  durationMs: number;
}

/**
 * One structured line per mutating request.
 *
 * Reads are excluded on purpose: the agent catalog is polled continuously and
 * auditing those would bury the writes that actually matter. The request id is
 * carried through so an audit line joins to the corresponding application logs.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuditLog');
  private readonly MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    if (!this.MUTATING_METHODS.has(request.method)) {
      return next.handle();
    }

    const start = Date.now();
    const enriched = request as unknown as {
      user?: { userId?: unknown; did?: unknown; role?: unknown };
      requestId?: string;
    };
    const user = enriched.user;

    const write = (statusCode: number) => {
      const entry: AuditEntry = {
        timestamp: new Date().toISOString(),
        requestId: enriched.requestId ?? null,
        method: request.method,
        path: request.url,
        userId: user ? String(user.userId ?? 'anonymous') : null,
        did: user?.did ? String(user.did) : null,
        role: user?.role ? String(user.role) : null,
        ip: request.ip ?? 'unknown',
        userAgent: request.get('user-agent') ?? 'unknown',
        statusCode,
        durationMs: Date.now() - start,
      };
      this.logger.log(JSON.stringify(entry));
    };

    return next.handle().pipe(
      tap({
        next: () => write(context.switchToHttp().getResponse().statusCode),
        // A rejected write is the case worth auditing most, so failures are
        // recorded rather than dropped with the exception.
        error: (error: { status?: number }) => write(error?.status ?? 500),
      }),
    );
  }
}
