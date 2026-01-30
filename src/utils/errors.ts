/**
 * User-friendly error mapping (inspired by discord-taco-web).
 * Keep this logic centralized so controllers can return consistent error messages.
 */

import { TOKEN_SYMBOL } from '../config/tokens';

function looksLikeHtmlErrorPayload(input: string): boolean {
  const lower = input.toLowerCase();
  return (
    lower.includes('<!doctype html') ||
    lower.includes('<html') ||
    lower.includes('<head') ||
    lower.includes('<body') ||
    lower.includes('herokucdn.com/error-pages') ||
    lower.includes('<iframe') ||
    // Some proxies return HTML but without doctype
    (lower.includes('<title>') && lower.includes('</title>'))
  );
}

export function getUserFriendlyError(error: unknown, tokenSymbol: string): string {
  const msg = error instanceof Error ? error.message : String(error);
  const t = (tokenSymbol || TOKEN_SYMBOL.ETH).toUpperCase();
  const lower = msg.toLowerCase();

  // If upstream returned HTML (e.g. Heroku error page), never surface it to end users.
  if (looksLikeHtmlErrorPayload(msg)) {
    return 'Something went wrong. Please try again.';
  }

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
    return `Transaction failed. Please check the sender smart account has enough ${t} (and ETH for gas), then try again.`;
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

  // Default: don't leak arbitrary internal errors to end users.
  return 'Something went wrong. Please try again.';
}

export function getRawErrorString(error: unknown, maxLen = 500): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (looksLikeHtmlErrorPayload(raw)) return 'Application error.';
  return raw.length > maxLen ? raw.slice(0, maxLen) + '...' : raw;
}
