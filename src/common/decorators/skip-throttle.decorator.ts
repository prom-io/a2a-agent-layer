import { SkipThrottle } from '@nestjs/throttler';

export { SkipThrottle };

/** Endpoints that orchestrators poll and that must never be rate limited. */
export const ProbeEndpoint = () => SkipThrottle();
