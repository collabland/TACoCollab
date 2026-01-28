import { domains } from '@nucypher/taco';
import { base, baseSepolia } from 'viem/chains';
import { getInfuraRpcUrl, getPimlicoBundlerUrl } from './rpc';

export type SupportedChainKey = 'base-sepolia' | 'base-mainnet';

export const DEFAULT_CHAIN_KEY: SupportedChainKey =
  process.env.TACO_ENV === 'PROD' ? 'base-mainnet' : 'base-sepolia';

export interface ChainConfig {
  key: SupportedChainKey;
  label: string;
  chainId: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viemChain: any;
  tacoDomain: (typeof domains)[keyof typeof domains];
  cohortId: number;
  signingCoordinatorChildAddress: string;
  signingChainRpcUrl: string;
  signingCoordinatorRpcUrl: string;
  bundlerUrl: string;
}

export const CHAIN_CONFIG: Record<SupportedChainKey, ChainConfig> = {
  'base-sepolia': {
    key: 'base-sepolia',
    label: 'Base Sepolia',
    chainId: 84532,
    viemChain: baseSepolia,
    tacoDomain: domains.DEVNET,
    cohortId: 2,
    signingCoordinatorChildAddress: '0xcc537b292d142dABe2424277596d8FFCC3e6A12D',
    signingChainRpcUrl: 'https://base-sepolia.drpc.org',
    signingCoordinatorRpcUrl: getInfuraRpcUrl('sepolia'),
    bundlerUrl: getPimlicoBundlerUrl(84532),
  },
  'base-mainnet': {
    key: 'base-mainnet',
    label: 'Base Mainnet',
    chainId: 8453,
    viemChain: base,
    tacoDomain: domains.Mainnet,
    cohortId: 3,
    signingCoordinatorChildAddress: '0xcc537b292d142dABe2424277596d8FFCC3e6A12D',
    signingChainRpcUrl: 'https://mainnet.base.org',
    signingCoordinatorRpcUrl: getInfuraRpcUrl('mainnet'),
    bundlerUrl: getPimlicoBundlerUrl(8453),
  },
};

export function isSupportedChainKey(value: string): value is SupportedChainKey {
  return value === 'base-sepolia' || value === 'base-mainnet';
}
