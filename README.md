# PROM Agent Infrastructure Layer (a2a-agent-layer)

On-chain and off-chain infrastructure for agent-to-agent communication on the PROM network. Handles agent identity, service catalog, pricing/tariffs, usage metering, policy enforcement, and the A2A request/response protocol.

> **Status:** Phase 1 complete

## Tech Stack

- **Backend**: NestJS (TypeScript)
- **Database**: PostgreSQL (TypeORM)
- **Smart Contracts**: Solidity 0.8.24 (Foundry)
- **Blockchain**: ethers.js v6

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your database and blockchain settings
```

### Database

Ensure PostgreSQL is running and the database exists:

```bash
createdb agent_db
```

TypeORM `synchronize: true` is enabled for development — tables are created automatically on startup.

### Run

```bash
npm run start:dev    # development with watch
npm run start        # production
npm run start:prod   # from compiled dist/
```

API documentation is available at `http://localhost:3001/api` (Swagger UI).

### Test

```bash
npm run test         # unit tests
npm run test:e2e     # integration tests (supertest)
```

### Lint

```bash
npm run lint
```

## Smart Contracts

Contracts live in `contracts/` and use Foundry.

```bash
cd contracts
forge install
forge build
forge test
```

### Deploy

```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
```

## Docker

```bash
docker build -f docker/Dockerfile -t a2a-agent-layer .
docker run -p 3001:3001 --env-file .env a2a-agent-layer
```

Or via the infra-compose stack (recommended):

```bash
# In a2a-infra-compose/
docker compose up --build -d
```

## Cross-Cutting Features

| Feature | File | Description |
|---|---|---|
| Graceful shutdown | `src/main.ts` | `enableShutdownHooks()` for clean SIGTERM handling |
| HTTP logging | `src/common/interceptors/logging.interceptor.ts` | Logs method, URL, status, duration, IP, user-agent |
| Unified errors | `src/common/filters/http-exception.filter.ts` | Consistent `{ statusCode, error, message, path, timestamp }` |
| Validation | `src/main.ts` | Global `ValidationPipe` with whitelist and transform |
| Blockchain | `src/common/blockchain/blockchain.service.ts` | ethers.js v6 provider + signer + contract ABI |

## Project Structure

```
src/
├── main.ts
├── app.module.ts
├── config/
│   ├── database.config.ts
│   └── blockchain.config.ts
├── common/
│   ├── dto/
│   │   └── pagination.dto.ts
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── interceptors/
│   │   └── logging.interceptor.ts
│   └── blockchain/
│       ├── blockchain.module.ts
│       ├── blockchain.service.ts
│       └── abis/
│           └── agent-registry.abi.ts
└── modules/
    ├── identity/       # Agent DID registration & management
    ├── catalog/        # Service catalog
    ├── pricing/        # Tariff definitions
    ├── metering/       # Usage tracking & receipts
    ├── protocol/       # A2A request/response envelope
    ├── policy/         # Spend limits, allowlists, verification
    └── health/         # Health check endpoint
contracts/
├── src/
│   ├── AgentRegistry.sol
│   ├── ServiceCatalog.sol
│   └── TariffRegistry.sol
├── test/
└── script/
test/
├── jest-e2e.json
└── app.e2e-spec.ts
```
