/**
 * User-friendly error mapping (inspired by discord-taco-web).
 * Keep this logic centralized so controllers can return consistent error messages.
 */

import { TOKEN_SYMBOL } from '../config/tokens';

export function getUserFriendlyError(error: unknown, tokenSymbol: string): string {
  const msg = error instanceof Error ? error.message : String(error);
  const t = (tokenSymbol || TOKEN_SYMBOL.ETH).toUpperCase();
  const lower = msg.toLowerCase();

  // ETH preflight (from TacoService.assertEthBalanceSufficient)
  if (lower.includes('insufficient eth balance in smart account')) {
    return 'Insufficient ETH in sender smart account. Please fund the smart account with more ETH (for the transfer value + gas), or reduce the amount.';
  }

  // AA / bundler simulation failures (common with Pimlico):
  // Keep before the generic "gas" matcher.
  if (
    lower.includes('useroperation reverted during simulation') ||
    lower.includes('useroperationexecutionerror') ||
    lower.includes('estimateuseroperationgas') ||
    lower.includes('eth_estimateuseroperationgas') ||
    lower.includes('bundler rejected') ||
    (lower.includes('execution reverted') && lower.includes('reason: 0x'))
  ) {
    return (
      'Transaction simulation failed (bundler rejected the UserOperation). ' +
      `Common causes: sender smart account has insufficient ${t} (and/or ETH for gas or ETH value transfers), ` +
      'or the paymaster/bundler policy disallows this call. ' +
      'Check the smart account balances (ETH + token) and retry; if still failing, try without sponsorship or use a different bundler/paymaster.'
    );
  }

  if (lower.includes('transfer amount exceeds balance')) {
    return `Insufficient ${t} balance. Sender smart account doesn't have enough ${t}.`;
  }
  if (lower.includes('insufficient funds')) {
    return 'Insufficient ETH for gas fees. Please fund the smart account with more ETH.';
  }
  if (lower.includes('nonce')) {
    return 'Transaction nonce error. Please try again.';
  }
  if (lower.includes('gas')) {
    return 'Gas estimation failed. The transaction may not be valid.';
  }

  if (msg.length > 200) return msg.slice(0, 200) + '...';
  return msg;
}

export function getRawErrorString(error: unknown, maxLen = 500): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > maxLen ? raw.slice(0, maxLen) + '...' : raw;
}
