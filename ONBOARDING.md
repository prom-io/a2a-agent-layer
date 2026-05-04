# a2a-agent-layer — Onboarding

Read this **after** the top-level `HANDOFF.md` in `a2a-infra-compose`. This document is specific to the Agent Layer.

> **Status note (May 4, 2026):** This service is the youngest of the three. As of the last commit (Apr 17), it has only the P0 Foundation scaffold + smart contracts in place. Most of the substantive work is still ahead. If you're picking this up, expect to do P1 Hardening from scratch.

## 1. What this service does

The Agent Layer is the "directory + protocol" layer for autonomous agents:

- **Identity** — agents register with a DID (Decentralized Identifier), public key, and HTTPS endpoint.
- **Catalog** — agents publish the services they offer (a typed list of capabilities + metadata).
- **Pricing** — agents declare tariffs (per-call, per-token, subscription) for each service.
- **Metering** — usage records, signed receipts, aggregation for billing.
- **Protocol** — A2A request/response envelope (versioned, signed) for agent-to-agent calls.
- **Policy** — spend limits, allowlists, verification requirements, configurable per agent.

Think of it as a "yellow pages + payment metadata + RPC envelope" layer.

## 2. How it fits in

```
                 register / lookup
Agent A ─────────────────────────▶ agent-layer (3001)
                                       │
                                       │ A2A request envelope
Agent A ──────────────────────────────▶│──────▶ Agent B (its agent-layer)
                                       │
                                       │ usage records → metering
                                       │
                                       ▼
                              ┌─────────────────────┐
                              │   payment-rail (3003) │  (escrow, settlement)
                              │   verification (3002) │  (verdicts on disputes)
                              └─────────────────────┘
```

## 3. Tech stack (specifics)

- NestJS 10, TypeORM, PostgreSQL
- ethers.js v6, Solidity 0.8.24 (Foundry)
- `class-validator` + Swagger
- Jest + Supertest for tests

## 4. Repository layout

```
a2a-agent-layer/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   │   ├── database.config.ts
│   │   └── blockchain.config.ts
│   ├── common/
│   │   ├── dto/pagination.dto.ts
│   │   ├── filters/http-exception.filter.ts
│   │   ├── interceptors/logging.interceptor.ts
│   │   └── blockchain/
│   │       ├── blockchain.module.ts
│   │       ├── blockchain.service.ts
│   │       └── abis/agent-registry.abi.ts
│   └── modules/
│       ├── identity/           # GET /identity, POST /identity, ...
│       │   ├── entities/agent.entity.ts
│       │   └── ...
│       ├── catalog/            # service catalog CRUD
│       ├── pricing/            # tariff definitions
│       ├── metering/           # usage records + receipts
│       ├── protocol/           # A2A request/response controller
│       │   ├── dto/a2a-request.dto.ts
│       │   └── dto/a2a-response.dto.ts
│       ├── policy/             # spend limits, allowlists
│       └── health/             # GET /health
├── contracts/
│   ├── src/
│   │   ├── AgentRegistry.sol
│   │   ├── ServiceCatalog.sol
│   │   └── TariffRegistry.sol
│   ├── test/
│   ├── script/Deploy.s.sol
│   └── foundry.toml
├── docker/Dockerfile
├── test/
└── .env.example
```

## 5. Environment variables

| Group | Variables |
|---|---|
| Database | `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` (default `agent_db`) |
| Blockchain | `RPC_URL`, `PRIVATE_KEY`, `AGENT_REGISTRY_ADDRESS`, `SERVICE_CATALOG_ADDRESS`, `TARIFF_REGISTRY_ADDRESS` |
| API | `PORT` (default 3001) |

## 6. Local development

### Full stack

```bash
cd a2a-infra-compose
docker compose up --build -d
docker compose logs -f agent-layer
```

### Bare metal

```bash
cd a2a-agent-layer
npm install
cp .env.example .env
createdb agent_db   # if using a local Postgres
npm run start:dev
curl http://localhost:3001/health
```

> Note: this repo doesn't yet have its own `Dockerfile.dev` / `docker-compose.dev.yml`. Adding them is one of the early P1 Hardening tasks (see "next steps").

## 7. Running tests

```bash
npm run test
npm run test:e2e
npm run test:cov
```

The current test suite is minimal (scaffold only). Add unit tests as you implement business logic.

## 8. Smart contracts

```bash
cd contracts
forge install
forge build
forge test
```

Three contracts:

| Contract | Purpose |
|---|---|
| `AgentRegistry` | Map DID → public key + endpoint, with active/inactive flag |
| `ServiceCatalog` | Map agent → list of service IDs with metadata hash |
| `TariffRegistry` | Map service → tariff structure (rate, currency, billing model) |

Deploy via the integrated infra:

```bash
cd ../a2a-infra-compose
./scripts/deploy-contracts.sh
```

## 9. Conventions specific to this repo

- **DIDs** — `did:prom:<address>` format. Validate with a regex (TBD: extract to a shared validator).
- **Endpoints** — must be HTTPS in production; `http://` accepted only when `NODE_ENV=development`.
- **Tariffs** — store the *unit* explicitly (`per_call`, `per_token`, `per_second`, `subscription`); never assume.
- **Protocol envelopes** — every A2A request must carry: `nonce`, `timestamp`, `from` DID, `to` DID, `signature`, `policyHash`. Signatures are EIP-191 over the canonical JSON of the envelope minus the signature field.
- **Idempotency** — POST endpoints should accept an optional `Idempotency-Key` header; metering and protocol endpoints especially. (Not yet implemented — early task.)

## 10. Common tasks

### Wire identity to on-chain

`identity.service.ts` already calls the contract opportunistically (degrades gracefully if `AGENT_REGISTRY_ADDRESS` is empty). When implementing related features:

1. Use `BlockchainService.getContract(address, ABI)`.
2. Wrap calls in try/catch; log a warning on failure but don't fail the HTTP request unless on-chain confirmation is essential.
3. If a write must succeed, return 202 Accepted and surface the tx hash.

### Add a new module

Same pattern as the other services: `nest g module modules/<name>`, controller, service, entity, DTOs with `class-validator`, register in `app.module.ts`.

## 11. What's done and what's next

Done:

- P0 Foundation — NestJS scaffold, all 7 modules with skeleton CRUD, 3 smart contracts, basic Foundry tests, Docker production image, e2e harness.

What this service still needs (rough P1 Hardening backlog — the Google Sheets plan is canonical):

- [ ] `Dockerfile.dev` + `docker-compose.dev.yml` (mirror of payment-rail / verification-network)
- [ ] TypeORM migrations + `data-source.ts` (replace `synchronize: true` for prod)
- [ ] Health endpoint with DB probe + `/ready`
- [ ] Swagger decorators on every endpoint (operations, params, responses)
- [ ] Strict DTO validation across modules (DIDs, hashes, URLs, UUIDs, decimal-string amounts)
- [ ] Logging interceptor with correlation IDs
- [ ] Global exception filter
- [ ] Database error filter (port from verification-network)
- [ ] Retry utility for blockchain (port from verification-network)
- [ ] Connection pool tuning
- [ ] e2e tests covering the seven modules
- [ ] Foundry tests beyond happy path (auth, edge cases)

After P1, expect P2 Security (mirror Payment Rail's stack: JWT, RBAC, throttler, security headers, audit, sanitize, CSRF, security e2e, threat model docs).

## 12. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `database "agent_db" does not exist` | Run `createdb agent_db` (host) or set `DATABASE_NAME` to an existing DB. |
| Module "BlockchainService" not exported | `BlockchainModule` must be imported in any module that injects it. Check the module's `imports`. |
| `forge install` fails on Windows | Run from WSL or git bash; symlinks for submodules can be flaky on plain PowerShell. |
| 500 on identity register | Likely an entity field constraint (e.g., DID uniqueness). Check the logs; `synchronize: true` keeps the schema in sync but won't migrate data. |
