import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { ControllerMetricsInterceptor } from './controller-metrics.interceptor';

@Global()
@Module({
  providers: [
    MetricsService,
    // Registered through DI (not useGlobalInterceptors in main.ts) so it gets
    // the shared registry and also applies inside e2e testing modules.
    { provide: APP_INTERCEPTOR, useClass: ControllerMetricsInterceptor },
  ],
  controllers: [MetricsController],
  exports: [MetricsService],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}
