import { registerAs } from '@nestjs/config';

export const blockchainConfig = registerAs('blockchain', () => ({
  rpcUrl: process.env.BLOCKCHAIN_RPC_URL || 'http://localhost:8545',
  privateKey: process.env.BLOCKCHAIN_PRIVATE_KEY || '',
}));
