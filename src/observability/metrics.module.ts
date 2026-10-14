import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { ControllerMetricsInterceptor } from './controller-metrics.interceptor';
import { DomainGaugesService } from './domain-gauges.service';
import { BusinessMetricsService } from './business-metrics.service';

@Global()
@Module({
  providers: [
    MetricsService,
    DomainGaugesService,
    BusinessMetricsService,
    // Registered through DI (not useGlobalInterceptors in main.ts) so it gets
    // the shared registry and also applies inside e2e testing modules.
    { provide: APP_INTERCEPTOR, useClass: ControllerMetricsInterceptor },
  ],
  controllers: [MetricsController],
  exports: [MetricsService, BusinessMetricsService],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}
