import { Injectable, Logger, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { isTracingStarted, stopTracing, tracingConfigFromEnv } from './tracing';

/**
 * Ties the tracing SDK to the application lifecycle.
 *
 * The SDK itself is started from `tracing.bootstrap` before Nest exists; this
 * only reports what happened and flushes pending spans on shutdown, so the
 * last requests before a deploy are not lost with the batch buffer.
 */
@Injectable()
export class TracingLifecycle implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Tracing');

  onModuleInit(): void {
    const config = tracingConfigFromEnv();
    if (isTracingStarted()) {
      this.logger.log(
        `OpenTelemetry tracing enabled: service=${config.serviceName}, exporter=${config.tracesUrl}, sampleRatio=${config.sampleRatio}`,
      );
    } else {
      this.logger.log('OpenTelemetry tracing disabled (set OTEL_EXPORTER_OTLP_ENDPOINT to enable)');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await stopTracing();
    } catch (error) {
      this.logger.warn(
        `OpenTelemetry shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

@Module({
  providers: [TracingLifecycle],
})
export class TracingModule {}
