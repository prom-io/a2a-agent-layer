import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness check' })
  @ApiResponse({ status: 200, description: 'Service is up' })
  check() {
    return {
      status: 'ok',
      service: 'a2a-agent-layer',
      timestamp: new Date().toISOString(),
    };
  }
}
