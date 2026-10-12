import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { Attributes, Span } from '@opentelemetry/api';
import { traceContextHeaders, tracedCall } from '../../observability/traced-blockchain';

@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  private provider!: ethers.JsonRpcProvider;
  private wallet!: ethers.Wallet;
  private rpcHost = 'unknown';

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const rpcUrl = this.configService.get<string>('blockchain.rpcUrl', 'http://localhost:8545');
    const privateKey = this.configService.get<string>(
      'blockchain.privateKey',
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    );
    this.rpcHost = safeHost(rpcUrl);

    // Every JSON-RPC request carries the W3C trace context of the span that
    // issued it, so an RPC gateway that understands traceparent continues the
    // same trace instead of starting a new one.
    const request = new ethers.FetchRequest(rpcUrl);
    request.preflightFunc = async (req) => {
      for (const [name, value] of Object.entries(traceContextHeaders())) {
        req.setHeader(name, value);
      }
      return req;
    };
    this.provider = new ethers.JsonRpcProvider(request);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.logger.log(`Blockchain connected: ${rpcUrl}, wallet: ${this.wallet.address}`);
  }

  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  getWallet(): ethers.Wallet {
    return this.wallet;
  }

  getContract(address: string, abi: ethers.InterfaceAbi): ethers.Contract {
    return new ethers.Contract(address, abi, this.wallet);
  }

  async getWalletAddress(): Promise<string> {
    return this.wallet.address;
  }

  async signMessage(message: string): Promise<string> {
    return this.traced('signMessage', { 'blockchain.signer': this.wallet.address }, () =>
      this.wallet.signMessage(message),
    );
  }

  /**
   * Runs an on-chain operation inside a `blockchain.<operation>` span that is
   * a child of the current request span. Use it around the whole retried call
   * so the retries and the wait for the receipt are visible as one unit.
   */
  traced<T>(
    operation: string,
    attributes: Attributes,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return tracedCall(
      `blockchain.${operation}`,
      { 'server.address': this.rpcHost, ...attributes },
      fn,
    );
  }

  hashData(data: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(data));
  }
}

/** Host of the RPC endpoint without credentials or API-key path segments. */
function safeHost(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).host;
  } catch {
    return 'unknown';
  }
}
