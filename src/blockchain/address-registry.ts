import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { activeNetwork } from '../config/networks';

export interface ContractAddresses {
  AgentRegistry: string;
  ServiceCatalog: string;
  TariffManager: string;
}

let cache: ContractAddresses | undefined;

// Addresses are loaded from deployments/<network>.json produced by the deploy
// script, with an env override so a single contract can be repointed quickly.
export function contractAddresses(): ContractAddresses {
  if (cache) return cache;
  const net = activeNetwork();
  const file = join(process.cwd(), 'deployments', `${net.name}.json`);
  const base = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  cache = {
    AgentRegistry: process.env.AGENT_REGISTRY_ADDRESS || base.AgentRegistry,
    ServiceCatalog: process.env.SERVICE_CATALOG_ADDRESS || base.ServiceCatalog,
    TariffManager: process.env.TARIFF_MANAGER_ADDRESS || base.TariffManager,
  };
  return cache;
}
