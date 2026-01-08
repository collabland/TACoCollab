import * as dotenv from 'dotenv';
import { ethers } from 'ethers';
import { createPublicClient, http, PublicClient } from 'viem';
import { createBundlerClient, createPaymasterClient } from 'viem/account-abstraction';
import { CHAIN_CONFIG, ChainConfig, SupportedChainKey } from '../config/chains';

dotenv.config();

export class Web3Service {
  private static instances: Partial<Record<SupportedChainKey, Web3Service>> = {};

  public readonly chainKey: SupportedChainKey;
  public readonly chainId: number;

  public signingChainProvider: ethers.providers.JsonRpcProvider;
  public signingCoordinatorProvider: ethers.providers.JsonRpcProvider;
  public publicClient: PublicClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public bundlerClient: any; // Type as any for now due to complex return type

  private constructor(chainKey: SupportedChainKey, config: ChainConfig) {
    this.chainKey = chainKey;
    this.chainId = config.chainId;

    const { signingChainRpcUrl, signingCoordinatorRpcUrl, bundlerUrl, viemChain } = config;

    if (!signingChainRpcUrl) {
      throw new Error(`Missing signing chain RPC URL for chain "${chainKey}"`);
    }
    if (!signingCoordinatorRpcUrl) {
      throw new Error(`Missing signing coordinator RPC URL for chain "${chainKey}"`);
    }
    if (!bundlerUrl) {
      throw new Error(`Missing bundler URL for chain "${chainKey}"`);
    }

    // Ethers providers
    this.signingChainProvider = new ethers.providers.JsonRpcProvider(signingChainRpcUrl);
    this.signingCoordinatorProvider = new ethers.providers.JsonRpcProvider(
      signingCoordinatorRpcUrl,
    );

    // Viem clients
    this.publicClient = createPublicClient({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chain: viemChain as any,
      transport: http(signingChainRpcUrl),
    }) as unknown as PublicClient;

    const paymasterClient = createPaymasterClient({
      transport: http(bundlerUrl),
    });

    this.bundlerClient = createBundlerClient({
      transport: http(bundlerUrl),
      paymaster: paymasterClient,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chain: viemChain as any,
    });
  }

  public static getInstance(chainKey: SupportedChainKey): Web3Service {
    if (!this.instances[chainKey]) {
      const config = CHAIN_CONFIG[chainKey];
      if (!config) {
        throw new Error(`Unsupported chain key "${chainKey}"`);
      }
      this.instances[chainKey] = new Web3Service(chainKey, config);
    }

    return this.instances[chainKey] as Web3Service;
  }
}
