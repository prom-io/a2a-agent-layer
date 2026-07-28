import { BadRequestException } from '@nestjs/common';
import { ParseDidPipe } from './parse-did.pipe';

describe('ParseDidPipe', () => {
  const pipe = new ParseDidPipe();

  it('splits a DID into method and identifier', () => {
    expect(pipe.transform('did:prom:agent-42')).toEqual({
      did: 'did:prom:agent-42',
      method: 'prom',
      identifier: 'agent-42',
    });
  });

  it.each(['did:key:z6Mk.abc', 'did:web:example.com', 'did:prom:a_b%20c'])(
    'accepts %s',
    (did) => {
      expect(pipe.transform(did).did).toBe(did);
    },
  );

  it.each([
    ['', 'empty'],
    ['did:prom', 'missing identifier'],
    ['did::agent', 'missing method'],
    ['prom:agent', 'missing scheme'],
    ['did:PROM:agent', 'uppercase method is not a valid method name'],
    ['did:prom:agent:extra', 'too many segments'],
  ])('rejects %s (%s)', (value) => {
    expect(() => pipe.transform(value)).toThrow(BadRequestException);
  });

  it('does not fold case in the identifier', () => {
    // Two agents may legitimately differ only by case; lowercasing here would
    // merge them into one registry entry.
    expect(pipe.transform('did:prom:Agent').identifier).toBe('Agent');
  });

  it('rejects undefined without throwing a type error', () => {
    expect(() => pipe.transform(undefined as unknown as string)).toThrow(
      BadRequestException,
    );
  });
});
