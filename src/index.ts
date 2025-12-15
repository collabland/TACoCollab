#!/usr/bin/env node

import { Implementation, toMetaMaskSmartAccount } from '@metamask/delegation-toolkit';
import { SigningCoordinatorAgent } from '@nucypher/shared';
import { conditions, domains, initialize, signUserOp, UserOperationToSign } from '@nucypher/taco';
import * as dotenv from 'dotenv';
import { ethers } from 'ethers';
import { Address, createPublicClient, http, parseEther, PublicClient } from 'viem';
import { createBundlerClient, createPaymasterClient } from 'viem/account-abstraction';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, sepolia } from 'viem/chains';

import { createViemTacoAccount } from './taco-account';

dotenv.config();

// Base Sepolia Chain ID
const BASE_SEPOLIA_CHAIN_ID = 84532;
const TACO_DOMAIN = domains.DEVNET;
const COHORT_ID = 1;

const TACO_SIGNING_COORDINATOR_CHILD_ADDRESS_84532 = '0xcc537b292d142dABe2424277596d8FFCC3e6A12D'; // TODO we can add a function to the SigningCoordinatorAgent to get this address dynamically from chain id
const AA_VERSION = 'mdt';

async function createTacoSmartAccount(
  publicClient: PublicClient,
  signingCoordinatorProvider: ethers.providers.JsonRpcProvider,
  signingChainProvider: ethers.providers.JsonRpcProvider,
) {
  await initialize();

  // On L2, we need to ensure we use the correct multisig address.
  // We fetch it during getParticipants, but we need it for createViemTacoAccount.
  // Let's explicitly fetch it here if on L2.
  const coordinator = new ethers.Contract(
    TACO_SIGNING_COORDINATOR_CHILD_ADDRESS_84532,
    ['function cohortMultisigs(uint32) view returns (address)'],
    signingChainProvider,
  );
  const cohortMultisigAddress = await coordinator.cohortMultisigs(COHORT_ID);
  console.log(`[L2] Updated Cohort Multisig Address: ${cohortMultisigAddress}`);

  const participants = await SigningCoordinatorAgent.getParticipants(
    signingCoordinatorProvider,
    TACO_DOMAIN,
    COHORT_ID,
  );
  const threshold = await SigningCoordinatorAgent.getThreshold(
    signingCoordinatorProvider,
    TACO_DOMAIN,
    COHORT_ID,
  );
  const signers = participants.map((p) => p.signerAddress as Address);

  // Create a TACo account using the cohort's multisig address
  const tacoAccount = createViemTacoAccount(cohortMultisigAddress as Address);
  console.log(`🎯 Using cohort multisig: ${cohortMultisigAddress}`);

  const smartAccount = await toMetaMaskSmartAccount({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // @ts-expect-error - Type incompatibility between viem versions used by delegation-toolkit and this project
    client: publicClient,
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

  const signingContext = await conditions.context.ConditionContext.forSigningCohort(
    provider,
    TACO_DOMAIN,
    COHORT_ID,
    BASE_SEPOLIA_CHAIN_ID,
  );

  return await signUserOp(
    provider,
    TACO_DOMAIN,
    COHORT_ID,
    BASE_SEPOLIA_CHAIN_ID,
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
  console.log(`\n💳 EOA Balance (${eoaAddress}): ${ethers.utils.formatEther(eoaBalance)} ETH`);
  console.log(
    `🏦 Smart Account (${smartAccountAddress}): ${ethers.utils.formatEther(smartAccountBalance)} ETH\n`,
  );
}

async function main() {
  try {
    // chain to use for signing
    const chain = BASE_SEPOLIA_CHAIN_ID === 84532 ? baseSepolia : sepolia;
    const signingChainProvider = new ethers.providers.JsonRpcProvider(
      process.env.SIGNING_CHAIN_RPC_URL!,
    );

    // chain for SigningCoordinatorAgent to get participants/threshold
    const signingCoordinatorProvider = new ethers.providers.JsonRpcProvider(
      process.env.ETH_RPC_URL!,
    );

    const localAccount = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
    const publicClient = createPublicClient({
      chain: chain,
      transport: http(process.env.SIGNING_CHAIN_RPC_URL),
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
      publicClient as any, // Cast to any to avoid strict PublicClient mismatch
      signingCoordinatorProvider,
      signingChainProvider,
    );
    console.log(`✅ Smart account created: ${smartAccount.address}`);
    console.log(`🔐 Threshold: ${threshold} signatures required\n`);
    console.log(`🔍 Checking balances... ${localAccount.address as Address}`);

    await logBalances(signingChainProvider, localAccount.address, smartAccount.address);

    const smartAccountBalance = await signingChainProvider.getBalance(smartAccount.address);
    if (smartAccountBalance.lt(ethers.utils.parseEther('0.001'))) {
      console.log('💰 Funding smart account...');
      const eoaWallet = new ethers.Wallet(process.env.PRIVATE_KEY as string, signingChainProvider);
      const nonce = await signingChainProvider.getTransactionCount(eoaWallet.address, 'pending');
      const fundTx = await eoaWallet.sendTransaction({
        to: smartAccount.address,
        value: ethers.utils.parseEther('0.001'),
        nonce,
      });
      console.log(`✅ Funded successfully!\n🔗 Tx: ${fundTx.hash}`);
      await fundTx.wait();
      await logBalances(signingChainProvider, localAccount.address, smartAccount.address);
    }

    const currentBalance = await signingChainProvider.getBalance(smartAccount.address);
    const gasReserve = ethers.utils.parseEther('0.0005');
    const transferAmount = currentBalance.gt(gasReserve)
      ? currentBalance.sub(gasReserve)
      : parseEther('0.0001');

    console.log('📝 Preparing transaction...');
    // @ts-expect-error - Type instantiation is excessively deep
    const userOp = await bundlerClient.prepareUserOperation({
      account: smartAccount,
      calls: [
        {
          to: localAccount.address as Address,
          value: BigInt(transferAmount.toString()),
        },
      ],
      ...fee,
      verificationGasLimit: BigInt(500_000),
    });
    console.log(`💸 Transfer amount: ${ethers.utils.formatEther(transferAmount)} ETH\n`);

    console.log('🔏 Signing with TACo...');

    // chain for signing is not necessarily the same as the chain the SigningCoordinator lives on (use corresponding ETH chain that SigningCoordinator is deployed to)
    const signature = await signUserOpWithTaco(userOp, signingCoordinatorProvider);
    console.log(`✅ Signature collected: ${signature.aggregatedSignature}\n`);

    console.log('🚀 Executing transaction...');
    const userOpHash = await bundlerClient.sendUserOperation({
      ...(userOp as any),
      signature: signature.aggregatedSignature as `0x${string}`,
    });
    console.log(`📝 UserOp Hash: ${userOpHash}`);

    const { receipt } = await bundlerClient.waitForUserOperationReceipt({
      hash: userOpHash,
    });
    console.log(`\n🎉 Transaction successful!`);
    console.log(`🔗 Tx: ${receipt.transactionHash}`);

    await logBalances(signingChainProvider, localAccount.address, smartAccount.address);
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
