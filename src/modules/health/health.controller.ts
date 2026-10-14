import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthDetail, HealthService, HealthStatus } from './health.service';
import { Public } from '../../common/decorators/public.decorator';
import { SkipThrottle } from '../../common/decorators/skip-throttle.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/auth/roles.enum';

@ApiTags('health')
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness check with database probe' })
  @ApiResponse({ status: 200, description: 'Service is up (status may be ok or degraded)' })
  async check(): Promise<HealthStatus> {
    return this.healthService.check();
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness check for orchestrator probes' })
  @ApiResponse({ status: 200, description: 'Service is ready to accept traffic' })
  async ready(): Promise<{ ready: boolean }> {
    return this.healthService.readiness();
  }

  // Not public: the response names the dependencies and carries their raw
  // error messages, which is more than an anonymous caller should learn.
  @Get('health/detail')
  @Roles(Role.OPERATOR, Role.ADMIN, Role.SERVICE)
  @ApiOperation({ summary: 'Per-dependency health with probe latencies (database, blockchain RPC)' })
  @ApiResponse({ status: 200, description: 'Overall status plus one entry per dependency' })
  @ApiResponse({ status: 401, description: 'Missing or invalid credentials' })
  @ApiResponse({ status: 403, description: 'Caller lacks the operator, admin or service role' })
  async detail(): Promise<HealthDetail> {
    return this.healthService.detail();
  }
}
