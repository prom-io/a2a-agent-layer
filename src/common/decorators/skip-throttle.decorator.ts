import { SkipThrottle as NestSkipThrottle } from '@nestjs/throttler';

/**
 * The throttlers are named (`short` and `long`, see throttler.config.ts), and
 * a bare `@SkipThrottle()` from @nestjs/throttler only skips the unnamed
 * default one. An endpoint marked that way was still rate limited and
 * answered 429 under load. Listing the names is what actually exempts it.
 */
export const THROTTLER_NAMES = { short: true, long: true } as const;

/** Exempts a controller or handler from every rate limit tier. */
export const SkipThrottle = () => NestSkipThrottle(THROTTLER_NAMES);

/** Endpoints that orchestrators poll and that must never be rate limited. */
export const ProbeEndpoint = () => SkipThrottle();
