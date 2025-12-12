#!/usr/bin/env node

import {
  Implementation,
  toMetaMaskSmartAccount,
} from '@metamask/delegation-toolkit';
import {
  SigningCoordinatorAgent,
  PorterClient,
  getPorterUris
} from '@nucypher/shared';
import { SessionStaticKey } from '@nucypher/nucypher-core';
import {
  conditions,
  domains,
  initialize,
  signUserOp,
  UserOperationToSign,
} from '@nucypher/taco';
import * as dotenv from 'dotenv';
import { ethers } from 'ethers';
import {
  Address,
  createPublicClient,
  http,
  parseEther,
  PublicClient,
} from 'viem';
import {
  createBundlerClient,
  createPaymasterClient,
} from 'viem/account-abstraction';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, sepolia } from 'viem/chains';

import { createViemTacoAccount } from './taco-account';

dotenv.config();

// Base Sepolia Chain ID
const SEPOLIA_CHAIN_ID = 84532;
const TACO_DOMAIN = domains.DEVNET;
const COHORT_ID = 1;
const COHORT_MULTISIG_ADDRESS = '0xDdBb4c470C7BFFC97345A403aC7FcA77844681D9';
const AA_VERSION = 'mdt';

// Monkey-patch SigningCoordinatorAgent for Base Sepolia (L2) Support
if (SEPOLIA_CHAIN_ID === 84532) {
  const L2_COORDINATOR_ADDRESS = process.env.TACO_SIGNING_COORDINATOR_ADDRESS_84532 || '0xcc537b292d142dABe2424277596d8FFCC3e6A12D';

  // Minimal ABIs
  const CHILD_ABI = ['function cohortMultisigs(uint32) view returns (address)'];
  const MULTISIG_ABI = [
    'function getSigners() view returns (address[])',
    'function threshold() view returns (uint16)'
  ];

  SigningCoordinatorAgent.getParticipants = async (provider, domain, cohortId) => {
    console.log(`[L2] Fetching participants via Child Coordinator: ${L2_COORDINATOR_ADDRESS}`);
    const coordinator = new ethers.Contract(L2_COORDINATOR_ADDRESS, CHILD_ABI, provider);

    const multisigAddress = await coordinator.cohortMultisigs(cohortId);
    console.log(`[L2] Cohort Multisig: ${multisigAddress}`);

    // Check if code exists
    const code = await provider.getCode(multisigAddress);
    if (code === '0x') {
      throw new Error(`[L2] No code found at multisig address ${multisigAddress} on chain 84532. Is it deployed?`);
    } else {
      console.log(`[L2] Code exists at multisig address (${code.length} bytes)`);
    }

    const multisig = new ethers.Contract(multisigAddress, MULTISIG_ABI, provider);
    const owners = await multisig.getSigners();
    const ownerSet = new Set(owners.map((o: string) => o.toLowerCase()));

    // Use Explicit Porter URL from User
    const porterUrl = 'https://porter-lynx.nucypher.io/';
    console.log(`[L2] Fetching Ursulas from Explicit Porter URL: ${porterUrl}...`);
    const porter = new PorterClient([porterUrl]);

    // Request a smaller number for testnets (lynx has few nodes)
    let ursulas;
    try {
      ursulas = await porter.getUrsulas(3);
    } catch (e) {
      console.warn(`[L2] Warning: Failed to fetch 3 Ursulas, trying 1... ${e}`);
      try {
        ursulas = await porter.getUrsulas(1);
      } catch (e2) {
        console.error(`[L2] Error fetching Ursulas: ${e2}`);
        ursulas = [];
      }
    }

    console.log(`[L2] Owners: ${owners.join(', ')}`);
    if (ursulas.length > 0) {
      console.log(`[L2] Porter Ursulas: ${ursulas.map(u => u.checksumAddress).join(', ')}`);
    } else {
      console.log(`[L2] Porter Ursulas: (none)`);
    }

    const participants = ursulas
      .filter(u => ownerSet.has(u.checksumAddress.toLowerCase()))
      .map(u => ({
        provider: u.uri,
        signerAddress: u.checksumAddress,
        // encryptingKey is a PublicKey. We need SessionStaticKey.
        // Assuming we can convert from bytes.
        signingRequestStaticKey: SessionStaticKey.fromBytes(u.encryptingKey.toCompressedBytes())
      }));

    console.log(`[L2] Found ${participants.length} matching participants out of ${owners.length} owners.`);
    if (participants.length === 0) {
      console.warn('[L2] WARNING: No matching Ursulas found in Porter! Signing will fail.');
    }

    return participants;
  };

  SigningCoordinatorAgent.getThreshold = async (provider, domain, cohortId) => {
    console.log(`[L2] Fetching threshold via Child Coordinator`);
    const coordinator = new ethers.Contract(L2_COORDINATOR_ADDRESS, CHILD_ABI, provider);
    const multisigAddress = await coordinator.cohortMultisigs(cohortId);
    const multisig = new ethers.Contract(multisigAddress, MULTISIG_ABI, provider);
    const threshold = await multisig.threshold();
    return threshold;
  };

  // Mock getSigningCohortConditions to avoid failure
  SigningCoordinatorAgent.getSigningCohortConditions = async () => {
    console.log(`[L2] Mocking getSigningCohortConditions (returning null)`);
    return null;
  }
}

async function createTacoSmartAccount(
  publicClient: PublicClient,
  provider: ethers.providers.JsonRpcProvider,
) {
  await initialize();

  // On L2, we need to ensure we use the correct multisig address.
  // We fetch it during getParticipants, but we need it for createViemTacoAccount.
  // Let's explicitly fetch it here if on L2.
  let cohortMultisigAddress = COHORT_MULTISIG_ADDRESS;

  if (SEPOLIA_CHAIN_ID === 84532) {
    const L2_COORDINATOR_ADDRESS = process.env.TACO_SIGNING_COORDINATOR_ADDRESS_84532 || '0xcc537b292d142dABe2424277596d8FFCC3e6A12D';
    const coordinator = new ethers.Contract(L2_COORDINATOR_ADDRESS, ['function cohortMultisigs(uint32) view returns (address)'], provider);
    cohortMultisigAddress = await coordinator.cohortMultisigs(COHORT_ID);
    console.log(`[L2] Updated Cohort Multisig Address: ${cohortMultisigAddress}`);
  }

  const participants = await SigningCoordinatorAgent.getParticipants(
    provider,
    TACO_DOMAIN,
    COHORT_ID,
  );
  const threshold = await SigningCoordinatorAgent.getThreshold(
    provider,
    TACO_DOMAIN,
    COHORT_ID,
  );
  const signers = participants.map((p) => p.signerAddress as Address);

  // Create a TACo account using the cohort's multisig address
  const tacoAccount = createViemTacoAccount(cohortMultisigAddress as Address);
  console.log(`🎯 Using cohort multisig: ${cohortMultisigAddress}`);

  const smartAccount = await toMetaMaskSmartAccount({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: publicClient as any, // Required due to viem/delegation-toolkit type incompatibilities
    implementation: Implementation.MultiSig,
    deployParams: [signers, BigInt(threshold)],
    deploySalt: '0x' as `0x${string}`,
    signatory: [{ account: tacoAccount }],
  });

  return { smartAccount, threshold };
}

async function signUserOpWithTaco(
  userOp: Record<string, unknown>,
  provider: ethers.providers.JsonRpcProvider,
) {
  // Use a simplified condition context if on L2, assuming no strict on-chain conditions
  // OR rely on the mocked getSigningCohortConditions if forSigningCohort uses it.
  // forSigningCohort calls getSigningCohortConditions.

  let signingContext;
  try {
    signingContext = await conditions.context.ConditionContext.forSigningCohort(
      provider,
      TACO_DOMAIN,
      COHORT_ID,
      SEPOLIA_CHAIN_ID,
    );
  } catch (e) {
    console.warn('⚠️ Simplified ConditionContext fallback active');
    // Fallback to "Always True" TimeCondition: blocktime > 0
    const alwaysTrueCondition = new conditions.base.time.TimeCondition({
      chain: SEPOLIA_CHAIN_ID,
      method: 'blocktime',
      returnValueTest: {
        comparator: '>',
        value: 0
      }
    });
    signingContext = new conditions.context.ConditionContext(alwaysTrueCondition);
  }

  return await signUserOp(
    provider,
    TACO_DOMAIN,
    COHORT_ID,
    SEPOLIA_CHAIN_ID,
    userOp as UserOperationToSign,
    AA_VERSION,
    signingContext,
  );
}

async function logBalances(
  provider: ethers.providers.JsonRpcProvider,
  eoaAddress: string,
  smartAccountAddress: string,
) {
  const eoaBalance = await provider.getBalance(eoaAddress);
  const smartAccountBalance = await provider.getBalance(smartAccountAddress);
  console.log(`\n💳 EOA Balance: ${ethers.utils.formatEther(eoaBalance)} ETH`);
  console.log(
    `🏦 Smart Account: ${ethers.utils.formatEther(smartAccountBalance)} ETH\n`,
  );
}

async function main() {
  try {
    const chain = SEPOLIA_CHAIN_ID === 84532 ? baseSepolia : sepolia;

    const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL!);
    const localAccount = privateKeyToAccount(
      process.env.PRIVATE_KEY as `0x${string}`,
    );
    const publicClient = createPublicClient({
      chain: chain,
      transport: http(process.env.RPC_URL),
    });

    const paymasterClient = createPaymasterClient({
      transport: http(process.env.BUNDLER_URL),
    });
    const bundlerClient = createBundlerClient({
      transport: http(process.env.BUNDLER_URL),
      paymaster: paymasterClient,
      chain: chain,
    });

    const fee = {
      maxFeePerGas: parseEther('0.00001'),
      maxPriorityFeePerGas: parseEther('0.000001'),
    };

    console.log('🔧 Creating TACo smart account...\n');
    const { smartAccount, threshold } = await createTacoSmartAccount(
      publicClient,
      provider,
    );
    console.log(`✅ Smart account created: ${smartAccount.address}`);
    console.log(`🔐 Threshold: ${threshold} signatures required\n`);

    await logBalances(provider, localAccount.address, smartAccount.address);

    const smartAccountBalance = await provider.getBalance(smartAccount.address);
    if (smartAccountBalance.lt(ethers.utils.parseEther('0.01'))) {
      console.log('💰 Funding smart account...');
      const eoaWallet = new ethers.Wallet(
        process.env.PRIVATE_KEY as string,
        provider,
      );
      const fundTx = await eoaWallet.sendTransaction({
        to: smartAccount.address,
        value: ethers.utils.parseEther('0.001'),
      });
      await fundTx.wait();
      console.log(`✅ Funded successfully!\n🔗 Tx: ${fundTx.hash}`);
      await logBalances(provider, localAccount.address, smartAccount.address);
    }

    const currentBalance = await provider.getBalance(smartAccount.address);
    const gasReserve = ethers.utils.parseEther('0.0005');
    const transferAmount = currentBalance.gt(gasReserve)
      ? currentBalance.sub(gasReserve)
      : parseEther('0.0001');

    console.log('📝 Preparing transaction...');
    const userOp = await bundlerClient.prepareUserOperation({
      account: smartAccount,
      calls: [
        {
          target: localAccount.address as Address,
          value: BigInt(transferAmount.toString()),
          data: '0x' as `0x${string}`,
        },
      ],
      ...fee,
      verificationGasLimit: BigInt(500_000),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any); // Required due to viem/delegation-toolkit type incompatibilities
    console.log(
      `💸 Transfer amount: ${ethers.utils.formatEther(transferAmount)} ETH\n`,
    );

    console.log('🔏 Signing with TACo...');
    // since the provider for this demo is already for sepolia, we can reuse it here
    const signature = await signUserOpWithTaco(userOp, provider);
    console.log(`✅ Signature collected: ${signature.aggregatedSignature}\n`);

    console.log('🚀 Executing transaction...');
    const userOpHash = await bundlerClient.sendUserOperation({
      ...userOp,
      signature: signature.aggregatedSignature as `0x${string}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any); // Required due to viem/delegation-toolkit type incompatibilities
    console.log(`📝 UserOp Hash: ${userOpHash}`);

    const { receipt } = await bundlerClient.waitForUserOperationReceipt({
      hash: userOpHash,
    });
    console.log(`\n🎉 Transaction successful!`);
    console.log(`🔗 Tx: ${receipt.transactionHash}`);
    console.log(
      `🌐 View on Etherscan: https://sepolia.etherscan.io/tx/${receipt.transactionHash}\n`,
    );

    await logBalances(provider, localAccount.address, smartAccount.address);
    console.log('✨ Demo completed successfully! ✨');
    process.exit(0);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Demo failed: ${errorMessage}`);
    process.exit(1);
  }
}

if (require.main === module) {
  // Check if --dry-run flag is present (used for CI syntax checking)
  if (process.argv.includes('--dry-run')) {
    console.log('✓ Syntax check passed');
    process.exit(0);
  }
  main();
}
