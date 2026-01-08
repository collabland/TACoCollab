import * as dotenv from 'dotenv';
import { domains } from '@nucypher/taco';
import { baseSepolia, sepolia } from 'viem/chains';

// Ensure .env variables are loaded before we read from process.env for chain config.
dotenv.config();

export type SupportedChainKey = 'base-sepolia' | 'eth-sepolia';

export const DEFAULT_CHAIN_KEY: SupportedChainKey = 'base-sepolia';

export interface ChainConfig {
  key: SupportedChainKey;
  label: string;
  chainId: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viemChain: any;
  tacoDomain: (typeof domains)[keyof typeof domains];
  cohortId: number;
  signingCoordinatorChildAddress: string;
  signingChainRpcUrl?: string;
  signingCoordinatorRpcUrl?: string;
  bundlerUrl?: string;
}

const baseSigningCoordinatorChildAddress =
  process.env.TACO_SIGNING_COORDINATOR_CHILD_ADDRESS_BASE ??
  // Fallback to the existing hardcoded address used for Base Sepolia in the original demo
  '0xcc537b292d142dABe2424277596d8FFCC3e6A12D';

const ethSepoliaSigningCoordinatorChildAddress =
  process.env.TACO_SIGNING_COORDINATOR_CHILD_ADDRESS_ETH ??
  '0x4D9Dec33A74C366d0A2b4746c56D75A25f3627b2';

export const CHAIN_CONFIG: Record<SupportedChainKey, ChainConfig> = {
  'base-sepolia': {
    key: 'base-sepolia',
    label: 'Base Sepolia',
    chainId: 84532,
    viemChain: baseSepolia,
    tacoDomain: domains.DEVNET,
    cohortId: 1,
    signingCoordinatorChildAddress: baseSigningCoordinatorChildAddress,
    signingChainRpcUrl: process.env.SIGNING_CHAIN_RPC_URL,
    signingCoordinatorRpcUrl: process.env.ETH_RPC_URL,
    bundlerUrl: process.env.BUNDLER_URL,
  },
  'eth-sepolia': {
    key: 'eth-sepolia',
    label: 'Ethereum Sepolia',
    chainId: 11155111,
    viemChain: sepolia,
    tacoDomain: domains.DEVNET,
    cohortId: 1,
    signingCoordinatorChildAddress: ethSepoliaSigningCoordinatorChildAddress,
    signingChainRpcUrl: process.env.ETH_RPC_URL,
    signingCoordinatorRpcUrl: process.env.ETH_RPC_URL,
    bundlerUrl: process.env.BUNDLER_URL_ETH,
  },
};

export function isSupportedChainKey(value: string): value is SupportedChainKey {
  return value === 'base-sepolia' || value === 'eth-sepolia';
}
