import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { MetricsService } from './metrics.service';
import { Public } from '../common/decorators/public.decorator';
import { SkipThrottle } from '../common/decorators/skip-throttle.decorator';

/**
 * Prometheus scrape target.
 *
 * Public and unthrottled because the scraper carries no credentials and polls
 * on a fixed interval; restrict access at the network layer (see
 * monitoring docs) rather than with application auth.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async scrape(@Res() res: Response): Promise<void> {
    // Written through the raw response so the exposition format is sent
    // verbatim with prom-client's own content type.
    res.setHeader('Content-Type', this.metrics.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.send(await this.metrics.scrape());
  }
}
