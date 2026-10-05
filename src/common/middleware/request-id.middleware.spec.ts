import { RequestIdMiddleware, REQUEST_ID_HEADER } from './request-id.middleware';
import { requestContext } from '../logging/request-context';

describe('RequestIdMiddleware', () => {
  const middleware = new RequestIdMiddleware();

  it('generates a request id when header is missing', () => {
    const req = { headers: {} } as unknown as Parameters<RequestIdMiddleware['use']>[0];
    const res = { setHeader: jest.fn() } as unknown as Parameters<RequestIdMiddleware['use']>[1];
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.headers[REQUEST_ID_HEADER]).toBeDefined();
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.headers[REQUEST_ID_HEADER]);
    expect(next).toHaveBeenCalled();
  });

  it('reuses incoming x-request-id header', () => {
    const req = { headers: { [REQUEST_ID_HEADER]: 'trace-abc' } } as unknown as Parameters<
      RequestIdMiddleware['use']
    >[0];
    const res = { setHeader: jest.fn() } as unknown as Parameters<RequestIdMiddleware['use']>[1];

    middleware.use(req, res, jest.fn());

    expect(req.headers[REQUEST_ID_HEADER]).toBe('trace-abc');
  });

  it('opens the request context for everything downstream', () => {
    const req = { headers: { [REQUEST_ID_HEADER]: 'trace-ctx' } } as unknown as Parameters<
      RequestIdMiddleware['use']
    >[0];
    const res = { setHeader: jest.fn() } as unknown as Parameters<RequestIdMiddleware['use']>[1];
    let seen: string | undefined;

    middleware.use(req, res, () => {
      seen = requestContext.requestId();
    });

    expect(seen).toBe('trace-ctx');
    expect(requestContext.requestId()).toBeUndefined();
  });

  it('ignores a blank incoming header', () => {
    const req = { headers: { [REQUEST_ID_HEADER]: '   ' } } as unknown as Parameters<
      RequestIdMiddleware['use']
    >[0];
    const res = { setHeader: jest.fn() } as unknown as Parameters<RequestIdMiddleware['use']>[1];

    middleware.use(req, res, jest.fn());

    expect(req.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
