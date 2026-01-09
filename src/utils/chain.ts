import { Request } from 'express';
import {
  CHAIN_CONFIG,
  DEFAULT_CHAIN_KEY,
  isSupportedChainKey,
  SupportedChainKey,
} from '../config/chains';

export function getChainKeyFromRequest(req: Request): SupportedChainKey {
  const raw = (req.query.chain ?? (req.body as { chain?: unknown })?.chain) as
    | string
    | string[]
    | undefined;

  const value = Array.isArray(raw) ? raw[0] : raw;

  if (!value) {
    return DEFAULT_CHAIN_KEY;
  }

  const normalized = value.toString().toLowerCase();

  // 1. Direct key match (e.g. "base-sepolia", "eth-sepolia")
  if (isSupportedChainKey(normalized)) {
    return normalized;
  }

  // 2. Match against human-readable labels coming from Discord (e.g. "Base Sepolia")
  for (const [key, cfg] of Object.entries(CHAIN_CONFIG)) {
    if (cfg.label.toLowerCase() === normalized) {
      return key as SupportedChainKey;
    }
  }

  // Fallback to default if an unsupported value is provided
  return DEFAULT_CHAIN_KEY;
}

export function getChainConfigFromRequest(req: Request) {
  const key = getChainKeyFromRequest(req);
  return CHAIN_CONFIG[key];
}
