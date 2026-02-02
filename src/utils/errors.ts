/**
 * User-friendly error mapping (inspired by discord-taco-web).
 * Keep this logic centralized so controllers can return consistent error messages.
 */

import { TOKEN_SYMBOL } from '../config/tokens';

export class HttpError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'HttpError';
  }
}

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
  if (error instanceof HttpError) return error.message;

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

  // Amount parsing / precision issues (ethers.js)
  if (lower.includes('fractional component exceeds decimals')) {
    return `Invalid amount: too many decimal places for ${t}.`;
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

  // Default: don't leak arbitrary internal errors to end users.
  return 'Something went wrong. Please try again.';
}

export function getRawErrorString(error: unknown, maxLen = 500): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (looksLikeHtmlErrorPayload(raw)) return 'Application error.';
  return raw.length > maxLen ? raw.slice(0, maxLen) + '...' : raw;
}
