import { SupportedChainKey } from '../config/chains';

export function getTxExplorerBaseUrl(chainKey: SupportedChainKey): string | null {
  if (chainKey === 'base-sepolia') return 'https://sepolia.basescan.org/tx/';
  if (chainKey === 'base-mainnet') return 'https://basescan.org/tx/';
  if (chainKey === 'eth-sepolia') return 'https://sepolia.etherscan.io/tx/';
  return null;
}

export function getAddressExplorerBaseUrl(chainKey: SupportedChainKey): string | null {
  if (chainKey === 'base-sepolia') return 'https://sepolia.basescan.org/address/';
  if (chainKey === 'base-mainnet') return 'https://basescan.org/address/';
  if (chainKey === 'eth-sepolia') return 'https://sepolia.etherscan.io/address/';
  return null;
}
