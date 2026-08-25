export interface NetworkProfile {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  confirmations: number;
}

export const NETWORKS: Record<string, NetworkProfile> = {
  'prom-testnet': {
    name: 'prom-testnet',
    chainId: Number(process.env.PROM_TESTNET_CHAIN_ID ?? 71234),
    rpcUrl: process.env.PROM_TESTNET_RPC_URL ?? '',
    explorerUrl: process.env.PROM_TESTNET_EXPLORER_URL ?? '',
    confirmations: Number(process.env.BLOCKCHAIN_CONFIRMATIONS ?? 3),
  },
};

export function activeNetwork(): NetworkProfile {
  const key = process.env.PROM_NETWORK ?? 'prom-testnet';
  const net = NETWORKS[key];
  if (!net) throw new Error(`Unknown network ${key}`);
  return net;
}
