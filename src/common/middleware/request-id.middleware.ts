import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { requestContext } from '../logging/request-context';

export const REQUEST_ID_HEADER = 'x-request-id';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // An id supplied by the caller is reused so one correlation id spans the
    // calling agent, this service and the payment rail instead of restarting
    // at each hop.
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      (Array.isArray(incoming) ? incoming[0] : incoming)?.trim() || randomUUID();
    req.headers[REQUEST_ID_HEADER] = requestId;
    (req as Request & { requestId: string }).requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    // Everything downstream runs inside the async context, so any log line
    // written while serving this request carries the id.
    requestContext.run({ requestId }, () => next());
  }
}
