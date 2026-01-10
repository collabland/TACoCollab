import { ethers } from 'ethers';
import { type Address } from 'viem';
import { toAccount } from 'viem/accounts';

/**
 * Creates a minimal Viem Account that serves as a placeholder for the MetaMask Smart Account.
 * This account is never actually used for signing - all real signing happens through the TACo network.
 *
 * @param cohortAddress - Address of the TACo cohort's multisig contract (used as the account address)
 * @returns A Viem Account with stub implementations
 */
export function createViemTacoAccount(cohortAddress: Address) {
  return toAccount({
    address: cohortAddress,

    // These methods are never called by the MetaMask Smart Account
    // They only need to exist to satisfy the Account interface
    async signMessage() {
      return '0x' as `0x${string}`;
    },

    async signTransaction() {
      return '0x' as `0x${string}`;
    },

    async signTypedData() {
      return '0x' as `0x${string}`;
    },
  });
}

/**
 * Deterministically derive the Collab.Land TACo salt for a Discord user.
 *
 * This MUST be the single source of truth for deploySalt anywhere we create
 * or counterfactually derive a TACo smart account for a Collab.Land user
 * (sender or receiver, create or execute flows).
 */
export function getCollabLandId(discordUserId: string): `0x${string}` {
  return ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(`${discordUserId}|Discord|Collab.Land`),
  ) as `0x${string}`;
}
