#!/usr/bin/env bash
# Verifies deployed contracts on the testnet explorer using forge verify-contract.
set -euo pipefail
: "${PROM_TESTNET_EXPLORER_API_URL:?}" "${PROM_TESTNET_EXPLORER_API_KEY:?}"
NET_FILE="deployments/prom-testnet.json"
for name in AgentRegistry ServiceCatalog TariffManager; do
  addr=$(node -e "console.log(require('./$NET_FILE').$name)")
  echo "Verifying $name at $addr"
  forge verify-contract "$addr" "src/$name.sol:$name" \
    --verifier-url "$PROM_TESTNET_EXPLORER_API_URL" \
    --etherscan-api-key "$PROM_TESTNET_EXPLORER_API_KEY" || echo "  (verify skipped/failed for $name)"
done
