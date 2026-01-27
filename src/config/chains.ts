import { domains } from '@nucypher/taco';
import * as dotenv from 'dotenv';
import { base, baseSepolia } from 'viem/chains';

// Ensure .env variables are loaded before we read from process.env for chain config.
dotenv.config();

export type SupportedChainKey = 'base-sepolia' | 'base-mainnet';

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
  process.env.TACO_SIGNING_COORDINATOR_CHILD_ADDRESS_BASE_SEPOLIA ??
  // Fallback to the existing hardcoded address used for Base Sepolia in the original demo
  '0xcc537b292d142dABe2424277596d8FFCC3e6A12D';

// Base Mainnet child coordinator address.
// IMPORTANT: Set TACO_SIGNING_COORDINATOR_CHILD_ADDRESS_BASE_MAINNET for real mainnet usage.
// We fall back to the Base Sepolia default to keep local dev from crashing if base-mainnet is never used.
const baseMainnetSigningCoordinatorChildAddress =
  process.env.TACO_SIGNING_COORDINATOR_CHILD_ADDRESS_BASE_MAINNET ??
  baseSigningCoordinatorChildAddress;

const ethSepoliaSigningCoordinatorChildAddress =
  process.env.TACO_SIGNING_COORDINATOR_CHILD_ADDRESS_ETH_SEPOLIA ??
  '0x4D9Dec33A74C366d0A2b4746c56D75A25f3627b2';

export const CHAIN_CONFIG: Record<SupportedChainKey, ChainConfig> = {
  'base-sepolia': {
    key: 'base-sepolia',
    label: 'Base Sepolia',
    chainId: 84532,
    viemChain: baseSepolia,
    tacoDomain: domains.DEVNET,
    cohortId: 2,
    signingCoordinatorChildAddress: baseSigningCoordinatorChildAddress,
    signingChainRpcUrl: process.env.SIGNING_CHAIN_RPC_URL,
    signingCoordinatorRpcUrl: process.env.ETH_RPC_URL,
    bundlerUrl: process.env.BUNDLER_URL,
  },
  'base-mainnet': {
    key: 'base-mainnet',
    label: 'Base Mainnet',
    chainId: 8453,
    viemChain: base,
    tacoDomain: domains.Mainnet,
    cohortId: 3,
    signingCoordinatorChildAddress: baseMainnetSigningCoordinatorChildAddress,
    signingChainRpcUrl: process.env.SIGNING_CHAIN_RPC_URL,
    signingCoordinatorRpcUrl: process.env.ETH_RPC_URL,
    bundlerUrl: process.env.BUNDLER_URL, // TODO: create it dynamically
  },
};

export function isSupportedChainKey(value: string): value is SupportedChainKey {
  return value === 'base-sepolia' || value === 'base-mainnet';
}
