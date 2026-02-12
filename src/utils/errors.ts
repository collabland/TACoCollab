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

  // TACo signing / policy conditions
  // When nodes refuse to sign, threshold is not met (often "Conditions not satisfied").
  if (
    lower.includes('threshold of signatures not met') ||
    lower.includes('taco signing failed') ||
    lower.includes('conditions not satisfied')
  ) {
    return (
      'Withdrawal could not be authorized by TACo (policy conditions not satisfied). ' +
      'Please re-run the command and ensure the same token/amount/address shown in Discord matches the request. ' +
      'If this keeps happening, the withdraw action may not be allowed by the current TACo policy on this chain.'
    );
  }
  // TACo signing infra (porter) temporarily unavailable.
  // Example: 503 Service Unavailable / "no healthy upstream" from https://porter.nucypher.io/sign
  // Some HTTP clients surface only "no healthy upstream" without the URL; handle that too.
  if (lower.includes('no healthy upstream')) {
    return 'TACo signing service is temporarily unavailable. Please try again later.';
  }
  if (
    (lower.includes('porter.nucypher.io') ||
      lower.includes('nucypher') ||
      lower.includes('porter') ||
      lower.includes('/sign')) &&
    (lower.includes('503') || lower.includes('service unavailable'))
  ) {
    return 'TACo signing service is temporarily unavailable. Please try again later.';
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
