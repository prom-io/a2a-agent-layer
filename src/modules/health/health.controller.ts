import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthService, HealthStatus } from './health.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness check with database probe' })
  @ApiResponse({ status: 200, description: 'Service is up (status may be ok or degraded)' })
  async check(): Promise<HealthStatus> {
    return this.healthService.check();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness check for orchestrator probes' })
  @ApiResponse({ status: 200, description: 'Service is ready to accept traffic' })
  async ready(): Promise<{ ready: boolean }> {
    return this.healthService.readiness();
  }
}
