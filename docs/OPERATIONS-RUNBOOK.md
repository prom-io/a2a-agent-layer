# Operations Runbook — Agent Layer

Operational guide for request verification, policy enforcement, and metering rollups in `a2a-agent-layer`.

## Request verification (canonical hashing)

Signed A2A envelopes are hashed with deterministic canonicalization before signature checks:

- Payload keys are sorted recursively (`sortKeysDeep`).
- Canonical string excludes `signature` and `requestHash`.
- Digest algorithm: **SHA-256** hex (`hashCanonicalRequest`).

**Symptoms**

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `Hash mismatch` in logs | Client used non-canonical JSON | Align client with `src/common/crypto/request-canonicalization.ts` |
| Signature valid but hash fails | Missing `nonce` / `policyDigest` in canonical input | Include optional fields in client hash |

**Fixture validation**

```bash
npm test -- request-canonicalization.spec
```

## Nonce replay window

`NonceStoreService` rejects duplicate `(agentFromId, nonce)` pairs within the replay window (default **5 minutes**).

| Env var | Default | Purpose |
|---------|---------|---------|
| _(in-memory)_ | 5 min window | TTL eviction every 60s |

**Symptoms**

| HTTP | Meaning |
|------|---------|
| `409 Conflict` | Nonce reused within window |

**Mitigation**

- Ensure callers generate a fresh UUID per request.
- For load tests, vary `nonce` per iteration.

## Policy engine

`PolicyEvaluatorService` evaluates active policies for the **target agent** (`agentToId`).

Precedence:

1. `denylist` subject patterns → deny
2. Matching `accessRules` with `effect: deny` → deny (**deny overrides allow**)
3. Matching `accessRules` with `effect: allow` → allow
4. `allowlist` subject patterns → allow
5. Default → deny (`403 Forbidden`)

Wildcard patterns use `*` (e.g. `did:prom:*`, `trusted-*`).

**Create / update policy**

```http
POST /policies
{
  "agentId": "<target-agent-uuid-or-did>",
  "name": "production-guardrails",
  "rules": {
    "accessRules": [
      { "effect": "allow", "subjects": ["did:prom:*"], "actions": ["invoke"] },
      { "effect": "deny", "subjects": ["did:prom:quarantine"], "actions": ["invoke"] }
    ]
  }
}
```

**Symptoms**

| HTTP | Meaning |
|------|---------|
| `403 Forbidden` | Policy denied (`Policy denied: …` message) |

## Hourly metering rollups

`MeteringRollupJob` aggregates `usage_records` into `usage_rollups` per `(agentId, hourBucket)` using **upsert** (`ON CONFLICT` update).

| Env var | Default | Purpose |
|---------|---------|---------|
| `METERING_ROLLUP_INTERVAL_MS` | `3600000` (1h) | Scheduler interval |

**Manual trigger (tests / recovery)**

```typescript
await meteringRollupJob.runHourlyRollup(new Date('2026-05-29T14:30:00Z'));
```

**Production migration**

```bash
npm run build
npm run migration:run
```

Table: `usage_rollups` — unique on `(agentId, hourBucket)`.

**Symptoms**

| Symptom | Action |
|---------|--------|
| Rollups empty | Confirm `usage_records` exist for the hour; check job logs |
| Duplicate key errors | Should not occur — upsert handles conflicts; verify migration applied |
| Stale totals | Re-run `runHourlyRollup` for the affected hour |

## Health & readiness

```bash
curl -s http://localhost:3000/health | jq
```

## Related tests

```bash
npm test
npm run test:e2e
```

E2E coverage: nonce replay (`409`), policy denial (`403`), rollup idempotency.
