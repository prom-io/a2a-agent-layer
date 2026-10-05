import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { SecurityHeadersMiddleware } from './common/middleware/security-headers.middleware';
import { CsrfMiddleware } from './common/middleware/csrf.middleware';

@Module({})
export class AppMiddlewareModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // RequestIdMiddleware first: it opens the async context that every later
    // log line reads the correlation id from.
    consumer
      .apply(RequestIdMiddleware, SecurityHeadersMiddleware, CsrfMiddleware)
      .forRoutes('*');
  }
}
