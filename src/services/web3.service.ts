import * as dotenv from 'dotenv';
import { ethers } from 'ethers';
import { createPublicClient, http, PublicClient } from 'viem';
import { createBundlerClient, createPaymasterClient } from 'viem/account-abstraction';
import { baseSepolia, sepolia } from 'viem/chains';

dotenv.config();

export class Web3Service {
  public static readonly BASE_SEPOLIA_CHAIN_ID = 84532;
  private static instance: Web3Service;

  public signingChainProvider: ethers.providers.JsonRpcProvider;
  public signingCoordinatorProvider: ethers.providers.JsonRpcProvider;
  public publicClient: PublicClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public bundlerClient: any; // Type as any for now due to complex return type

  private constructor() {
    const chain = Web3Service.BASE_SEPOLIA_CHAIN_ID === 84532 ? baseSepolia : sepolia;

    // Ethers providers
    this.signingChainProvider = new ethers.providers.JsonRpcProvider(process.env.SIGNING_CHAIN_RPC_URL!);
    this.signingCoordinatorProvider = new ethers.providers.JsonRpcProvider(process.env.ETH_RPC_URL!);

    // Viem clients
    this.publicClient = createPublicClient({
      chain: chain,
      transport: http(process.env.SIGNING_CHAIN_RPC_URL),
    }) as unknown as PublicClient;

    const paymasterClient = createPaymasterClient({
      transport: http(process.env.BUNDLER_URL),
    });

    this.bundlerClient = createBundlerClient({
      transport: http(process.env.BUNDLER_URL),
      paymaster: paymasterClient,
      chain: chain,
    });
  }

  public static getInstance(): Web3Service {
    if (!Web3Service.instance) {
      Web3Service.instance = new Web3Service();
    }
    return Web3Service.instance;
  }
}
