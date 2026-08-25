# Testnet

## Addresses
Loaded from `deployments/prom-testnet.json` (written by the deploy script) and
overridable via `AGENT_REGISTRY_ADDRESS`, `SERVICE_CATALOG_ADDRESS`, `TARIFF_MANAGER_ADDRESS`.

## Deploy steps
1. `cp .env.testnet.example .env` and fill the RPC + explorer keys.
2. `npx ts-node scripts/deploy-contracts.ts` - deploys and writes addresses.
3. `./scripts/verify-contracts.sh` - verifies on the explorer.
4. Restart the service; the address registry picks up the new file.

## Rollback
Point the env address overrides at the previous deployment and restart. The
registry prefers env over the deployments file, so no redeploy is needed.
