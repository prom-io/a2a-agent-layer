import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';

export const throttlerConfigFactory = (
  configService: ConfigService,
): ThrottlerModuleOptions => ({
  throttlers: [
    {
      name: 'short',
      ttl: configService.get<number>('security.throttle.shortTtl', 1000),
      limit: configService.get<number>('security.throttle.shortLimit', 10),
    },
    {
      name: 'long',
      ttl: configService.get<number>('security.throttle.longTtl', 60000),
      limit: configService.get<number>('security.throttle.longLimit', 100),
    },
  ],
});
