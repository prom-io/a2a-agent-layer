export type PolicyEffect = 'allow' | 'deny';

export interface AccessRule {
  effect: PolicyEffect;
  subjects: string[];
  actions?: string[];
  resources?: string[];
}

export interface PolicyEvaluationContext {
  subject: string;
  action: string;
  resource: string;
}

export interface PolicyRuleset {
  allowlist?: string[];
  denylist?: string[];
  accessRules?: AccessRule[];
}

/**
 * Match a value against a pattern supporting `*` single-segment wildcards.
 * Examples: `did:prom:*` matches `did:prom:agent-1`; `agent-*` matches `agent-billing`.
 */
export function matchWildcard(pattern: string, value: string): boolean {
  if (pattern === '*') {
    return true;
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function matchesAny(patterns: string[] | undefined, value: string): boolean {
  if (!patterns || patterns.length === 0) {
    return true;
  }
  return patterns.some((pattern) => matchWildcard(pattern, value));
}

function ruleApplies(rule: AccessRule, ctx: PolicyEvaluationContext): boolean {
  return (
    matchesAny(rule.subjects, ctx.subject) &&
    matchesAny(rule.actions, ctx.action) &&
    matchesAny(rule.resources, ctx.resource)
  );
}

/**
 * Evaluate access for a subject/action/resource tuple.
 * Deny rules take precedence over allow rules; default is deny.
 */
export function evaluatePolicyAccess(
  rules: PolicyRuleset,
  ctx: PolicyEvaluationContext,
): { allowed: boolean; reason: string } {
  const hasAccessConstraints =
    (rules.accessRules?.length ?? 0) > 0 ||
    (rules.allowlist?.length ?? 0) > 0 ||
    (rules.denylist?.length ?? 0) > 0;

  if (!hasAccessConstraints) {
    return { allowed: true, reason: 'no access constraints' };
  }

  if (rules.denylist?.some((pattern) => matchWildcard(pattern, ctx.subject))) {
    return { allowed: false, reason: 'subject on denylist' };
  }

  const accessRules = rules.accessRules ?? [];
  const matching = accessRules.filter((rule) => ruleApplies(rule, ctx));

  const denyMatch = matching.find((rule) => rule.effect === 'deny');
  if (denyMatch) {
    return { allowed: false, reason: 'matched deny access rule' };
  }

  const allowMatch = matching.find((rule) => rule.effect === 'allow');
  if (allowMatch) {
    return { allowed: true, reason: 'matched allow access rule' };
  }

  if (rules.allowlist?.some((pattern) => matchWildcard(pattern, ctx.subject))) {
    return { allowed: true, reason: 'subject on allowlist' };
  }

  return { allowed: false, reason: 'no matching allow rule' };
}
