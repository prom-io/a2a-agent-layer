import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('produces a salt:key pair', async () => {
    const hash = await service.hash('correct horse battery staple');
    const [salt, key] = hash.split(':');
    expect(salt).toHaveLength(32);
    expect(key).toHaveLength(128);
  });

  it('accepts the correct password', async () => {
    const hash = await service.hash('s3cret');
    await expect(service.verify('s3cret', hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await service.hash('s3cret');
    await expect(service.verify('s3crat', hash)).resolves.toBe(false);
  });

  it('salts each hash, so equal passwords hash differently', async () => {
    const [a, b] = await Promise.all([service.hash('same'), service.hash('same')]);
    expect(a).not.toBe(b);
    await expect(service.verify('same', a)).resolves.toBe(true);
    await expect(service.verify('same', b)).resolves.toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['nosalt', 'no separator'],
    [':onlykey', 'empty salt'],
    ['onlysalt:', 'empty key'],
    ['salt:zz', 'key too short'],
  ])('rejects malformed stored value %s (%s)', async (stored) => {
    await expect(service.verify('whatever', stored)).resolves.toBe(false);
  });

  it('rejects a null stored value without throwing', async () => {
    await expect(
      service.verify('whatever', null as unknown as string),
    ).resolves.toBe(false);
  });

  it('handles unicode and long passwords', async () => {
    const password = 'пароль-🔐-' + 'x'.repeat(500);
    const hash = await service.hash(password);
    await expect(service.verify(password, hash)).resolves.toBe(true);
  });
});
