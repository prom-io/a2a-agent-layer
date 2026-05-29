import { evaluatePolicyAccess, matchWildcard } from './policy-evaluator';

describe('policy-evaluator', () => {
  it('matches wildcard subjects', () => {
    expect(matchWildcard('did:prom:*', 'did:prom:agent-1')).toBe(true);
    expect(matchWildcard('did:prom:*', 'did:other:agent-1')).toBe(false);
  });

  it('deny access rules override allow rules for the same subject', () => {
    const result = evaluatePolicyAccess(
      {
        accessRules: [
          { effect: 'allow', subjects: ['did:prom:*'], actions: ['invoke'] },
          { effect: 'deny', subjects: ['did:prom:blocked'], actions: ['invoke'] },
        ],
      },
      { subject: 'did:prom:blocked', action: 'invoke', resource: 'svc-1' },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('matched deny access rule');
  });

  it('allows subjects on allowlist when no access rules match', () => {
    const result = evaluatePolicyAccess(
      { allowlist: ['trusted-*'] },
      { subject: 'trusted-bot', action: 'invoke', resource: 'svc-1' },
    );
    expect(result.allowed).toBe(true);
  });

  it('defaults to deny when no rule matches', () => {
    const result = evaluatePolicyAccess(
      { accessRules: [{ effect: 'allow', subjects: ['admin'], actions: ['*'] }] },
      { subject: 'guest', action: 'invoke', resource: 'svc-1' },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no matching allow rule');
  });
});
