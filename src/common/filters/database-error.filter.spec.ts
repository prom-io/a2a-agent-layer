import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { DatabaseErrorFilter } from './database-error.filter';

function makeHost(): { host: ArgumentsHost; res: { status: jest.Mock; json: jest.Mock } } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('DatabaseErrorFilter', () => {
  const filter = new DatabaseErrorFilter();

  it('maps EntityNotFoundError to 404', () => {
    const { host, res } = makeHost();
    filter.catch(new EntityNotFoundError({} as never, {}), host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
  });

  it('maps unique violation (23505) to 409', () => {
    const { host, res } = makeHost();
    const err = new QueryFailedError('INSERT', [], new Error('dup')) as QueryFailedError & {
      code?: string;
    };
    err.code = '23505';
    filter.catch(err, host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
  });
});
