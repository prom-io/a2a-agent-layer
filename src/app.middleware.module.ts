import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { CsrfMiddleware } from './common/middleware/csrf.middleware';

@Module({})
export class AppMiddlewareModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware, CsrfMiddleware)
      .forRoutes('*');
  }
}
