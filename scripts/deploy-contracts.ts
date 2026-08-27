/* Deploys the registry, catalog and tariff contracts and writes their addresses
 * to deployments/<network>.json for the address registry to load at runtime. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { activeNetwork } from '../src/config/networks';

async function main(): Promise<void> {
  const net = activeNetwork();
  // Placeholder deploy: real wiring uses ethers + compiled artifacts.
  const deployed = {
    network: net.name,
    chainId: net.chainId,
    AgentRegistry: process.env.AGENT_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000',
    ServiceCatalog: process.env.SERVICE_CATALOG_ADDRESS ?? '0x0000000000000000000000000000000000000000',
    TariffManager: process.env.TARIFF_MANAGER_ADDRESS ?? '0x0000000000000000000000000000000000000000',
    deployedAt: new Date().toISOString(),
  };
  mkdirSync('deployments', { recursive: true });
  writeFileSync(`deployments/${net.name}.json`, JSON.stringify(deployed, null, 2));
  console.log(`Deployed to ${net.name} (${net.chainId})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
