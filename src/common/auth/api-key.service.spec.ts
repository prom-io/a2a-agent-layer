import { ConfigService } from '@nestjs/config';
import { ApiKeyService } from './api-key.service';

function serviceWith(raw: string): ApiKeyService {
  const config = {
    get: (key: string, fallback: unknown) =>
      key === 'security.apiKeys.raw' ? raw : fallback,
  } as unknown as ConfigService;

  const service = new ApiKeyService(config);
  service.onModuleInit();
  return service;
}

describe('ApiKeyService', () => {
  it('accepts a configured key and reports its label', () => {
    const service = serviceWith('payment-rail:secret-one,verification:secret-two');
    expect(service.verify('secret-one')).toEqual({ label: 'payment-rail' });
    expect(service.verify('secret-two')).toEqual({ label: 'verification' });
  });

  it('rejects an unknown key', () => {
    expect(serviceWith('rail:secret').verify('wrong')).toBeNull();
  });

  it('rejects when no keys are configured', () => {
    const service = serviceWith('');
    expect(service.enabled).toBe(false);
    expect(service.verify('anything')).toBeNull();
  });

  it('rejects undefined and empty input', () => {
    const service = serviceWith('rail:secret');
    expect(service.verify(undefined)).toBeNull();
    expect(service.verify('')).toBeNull();
  });

  it('keeps colons that belong to the key itself', () => {
    // Only the first colon separates label from key; splitting on every colon
    // would silently truncate any key containing one.
    const service = serviceWith('rail:aa:bb:cc');
    expect(service.verify('aa:bb:cc')).toEqual({ label: 'rail' });
  });

  it('ignores malformed entries without dropping the valid ones', () => {
    const service = serviceWith('broken,:nolabel,trailing:,rail:good');
    expect(service.verify('good')).toEqual({ label: 'rail' });
    expect(service.verify('')).toBeNull();
  });

  it('is not fooled by a key that is a prefix of a real one', () => {
    const service = serviceWith('rail:supersecret');
    expect(service.verify('super')).toBeNull();
    expect(service.verify('supersecretx')).toBeNull();
  });
});
