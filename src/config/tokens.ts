import { Address } from 'viem';
import { ethers } from 'ethers';

import { optionalEnv } from './env';

export const TOKEN_SYMBOL = {
  ETH: 'ETH',
  USDC: 'USDC',
  USDT: 'USDT',
} as const;

export type SupportedTokenSymbol = (typeof TOKEN_SYMBOL)[keyof typeof TOKEN_SYMBOL];

export const TOKEN_LIST_API_URL = 'https://tokens.coingecko.com/base-sepolia/all.json';

const FALLBACK_TOKEN_ADDRESSES: Record<string, Record<number, Address>> = {
  USDC: {
    84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia
    8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base Mainnet
  },
};

export function normalizeTokenSymbol(value: unknown): SupportedTokenSymbol {
  const symbol = String(value || TOKEN_SYMBOL.ETH).toUpperCase();
  if (symbol === TOKEN_SYMBOL.USDC) return TOKEN_SYMBOL.USDC;
  if (symbol === TOKEN_SYMBOL.USDT) return TOKEN_SYMBOL.USDT;
  return TOKEN_SYMBOL.ETH;
}

/**
 * Fetch token contract address from a token list API.
 * Falls back to hardcoded addresses if API fails or doesn't include the token.
 *
 * Mirrors discord-taco-web behavior.
 */
export async function getTokenAddress(tokenSymbol: string, chainId: number): Promise<Address> {
  const symbol = tokenSymbol.toUpperCase();
  try {
    const response = await fetch(TOKEN_LIST_API_URL);
    if (response.ok) {
      const data = (await response.json()) as {
        tokens?: Array<{
          symbol: string;
          address: string;
          chainId?: number;
        }>;
      };
      const token = data.tokens?.find(
        (t) => t.symbol.toUpperCase() === symbol && (t.chainId === chainId || !t.chainId),
      );
      if (token?.address) {
        return token.address as Address;
      }
    }
  } catch {
    // ignore and fall back
  }

  const fallback = FALLBACK_TOKEN_ADDRESSES[symbol]?.[chainId];
  if (fallback) return fallback;

  throw new Error(
    `Unknown token ${symbol} on chain ${chainId}. No API result or fallback available.`,
  );
}

/**
 * Fetch token decimals from the token contract.
 * Returns 18 for ETH, calls decimals() for ERC20 tokens.
 * Mirrors discord-taco-web behavior.
 */
export async function getTokenDecimals(
  tokenSymbol: string,
  tokenAddress: Address,
  provider: ethers.providers.JsonRpcProvider,
): Promise<number> {
  const symbol = tokenSymbol.toUpperCase();

  if (symbol === TOKEN_SYMBOL.ETH) return 18;

  try {
    const contract = new ethers.Contract(
      tokenAddress,
      ['function decimals() view returns (uint8)'],
      provider,
    );
    const decimals = await contract.decimals();
    return Number(decimals);
  } catch {
    if (symbol === TOKEN_SYMBOL.USDC || symbol === TOKEN_SYMBOL.USDT) return 6;
    return 18;
  }
}
