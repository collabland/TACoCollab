import { Implementation, toMetaMaskSmartAccount } from '@metamask/delegation-toolkit';
import { SigningCoordinatorAgent } from '@nucypher/shared';
import { conditions, initialize, signUserOp, UserOperationToSign } from '@nucypher/taco';
import { ethers } from 'ethers';
import { Address } from 'viem';
import { CHAIN_CONFIG, SupportedChainKey } from '../config/chains';
import { createViemTacoAccount, getCollabLandId } from '../utils/taco-account';
import { Web3Service } from './web3.service';

export class TacoService {
  private static instance: TacoService;
  private initialized = false;

  /**
   * MetaMask Smart Account AA version used by TACo.
   * This must match the version expected by the signing coordinator.
   */
  private readonly AA_VERSION = 'mdt';

  private constructor() {}

  public static getInstance(): TacoService {
    if (!TacoService.instance) {
      TacoService.instance = new TacoService();
    }
    return TacoService.instance;
  }

  public async initializeTaco(): Promise<void> {
    if (this.initialized) return;
    await initialize();
    this.initialized = true;
    console.log('TACo initialized');
  }

  public async createSmartAccount(userId: string, chainKey: SupportedChainKey) {
    const { smartAccount, threshold } = await this.getSmartAccount(userId, chainKey);

    return {
      address: (smartAccount as { address: string }).address,
      threshold,
      // This service only derives the counterfactual address; actual deployment
      // happens when a UserOperation is executed on-chain.
      deployed: false,
    };
  }

  public async transferFromSmartAccount(params: {
    userId: string;
    to: Address;
    amount: string;
    chain: SupportedChainKey;
    discordContext: {
      timestamp: string;
      signature: string;
      payload: string;
    };
  }): Promise<{
    smartAccountAddress: string;
    to: string;
    amount: string;
    userOpHash: string;
    transactionHash: string;
  }> {
    await this.initializeTaco();

    const { chain, userId, to, amount, discordContext } = params;
    const web3 = Web3Service.getInstance(chain);
    const { smartAccount } = await this.getSmartAccount(userId, chain);

    // Default to the explicit amount & recipient provided to the API.
    let transferValue = ethers.utils.parseEther(amount);
    let callTarget: Address = to;

    const baseGasPrice = await web3.publicClient.getGasPrice();

    // Try to align call target & amount with Discord payload, like the demo script.
    // If parsing fails, we gracefully fall back to the raw values from params.
    try {
      const parsed = JSON.parse(discordContext.payload) as {
        member?: { user?: { id?: string } };
        data?: {
          options?: Array<{
            name?: string;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            options?: Array<{ name?: string; value?: any }>;
          }>;
        };
      };

      const executeCmd = parsed?.data?.options?.find((o) => o?.name === 'execute');
      const opts = executeCmd?.options ?? [];

      const amountOpt = opts.find((o) => o?.name === 'amount')?.value;
      const receiverOpt = opts.find((o) => o?.name === 'receiver')?.value;

      if (amountOpt !== undefined) {
        transferValue = ethers.utils.parseEther(String(amountOpt));
      }

      if (receiverOpt) {
        const recipientUserId = String(receiverOpt);
        const { smartAccount: recipientSmartAccount } = await this.getSmartAccount(
          recipientUserId,
          chain,
        );
        callTarget = (recipientSmartAccount as { address: Address }).address;
      }
    } catch (err) {
      console.warn(
        'Failed to derive AA recipient from Discord payload, using raw `to` address.',
        err,
      );
    }

    // Pimlico bundler enforces a minimum priority fee of 1_000_000 wei
    // (see error: "maxPriorityFeePerGas must be at least 1000000").
    const MIN_PRIORITY_FEE = 1_000_000n;
    const suggestedPriorityFee = baseGasPrice / 10n;

    const fee = {
      maxFeePerGas: (baseGasPrice * 12n) / 10n,
      maxPriorityFeePerGas:
        suggestedPriorityFee < MIN_PRIORITY_FEE ? MIN_PRIORITY_FEE : suggestedPriorityFee,
    };

    const userOp = await web3.bundlerClient.prepareUserOperation({
      account: smartAccount,
      calls: [
        {
          to: callTarget,
          value: BigInt(transferValue.toString()),
        },
      ],
      ...fee,
      verificationGasLimit: BigInt(500_000),
    });
    const signature = await this.signUserOpWithTaco({
      ...(userOp as Record<string, unknown>),
      chainKey: chain,
      discordContext,
    });
    const userOpHash = await web3.bundlerClient.sendUserOperation({
      ...(userOp as any),
      signature: signature.aggregatedSignature as `0x${string}`,
    });
    const { receipt } = await web3.bundlerClient.waitForUserOperationReceipt({
      hash: userOpHash,
    });

    return {
      smartAccountAddress: (smartAccount as { address: string }).address,
      to,
      amount,
      userOpHash,
      transactionHash: receipt.transactionHash,
    };
  }

  /**
   * Internal helper to derive (or counterfactually create) the TACo smart account
   * for a given user identifier on a specific chain.
   *
   * This is the single place where we:
   * - Fetch cohort multisig
   * - Fetch participants / threshold
   * - Build the TACo viem account
   * - Compute the deploySalt via getCollabLandId("{DISCORD_USER_ID}|Discord|Collab.Land")
   *
   * All sender/receiver account derivations MUST go through this helper to avoid
   * any drift in deploySalt or deployment parameters.
   */
  private async getSmartAccount(
    userId: string,
    chainKey: SupportedChainKey,
  ): Promise<{ smartAccount: unknown; threshold: number }> {
    await this.initializeTaco();
    const web3 = Web3Service.getInstance(chainKey);
    const chainConfig = CHAIN_CONFIG[chainKey];

    if (!chainConfig.signingCoordinatorChildAddress) {
      throw new Error(
        `Missing TACo SigningCoordinator child address for chain "${chainKey}". ` +
          `Set the appropriate TACO_SIGNING_COORDINATOR_CHILD_ADDRESS_* environment variable.`,
      );
    }

    // Fetch cohort multisig
    const coordinator = new ethers.Contract(
      chainConfig.signingCoordinatorChildAddress,
      ['function cohortMultisigs(uint32) view returns (address)'],
      web3.signingChainProvider,
    );
    const cohortMultisigAddress = await coordinator.cohortMultisigs(chainConfig.cohortId);

    // Fetch participants/threshold
    const participants = await SigningCoordinatorAgent.getParticipants(
      web3.signingCoordinatorProvider,
      chainConfig.tacoDomain,
      chainConfig.cohortId,
    );
    const threshold = await SigningCoordinatorAgent.getThreshold(
      web3.signingCoordinatorProvider,
      chainConfig.tacoDomain,
      chainConfig.cohortId,
    );
    const signers = participants.map((p) => p.signerAddress as Address);

    const tacoAccount = createViemTacoAccount(cohortMultisigAddress as Address);

    // Use the shared Collab.Land salt helper so that every TACo smart account
    // for this user (whether explicitly created or used as a sender/receiver during
    // execution) is derived from the exact same deploySalt.
    const deploySalt = getCollabLandId(userId);

    const smartAccount = await toMetaMaskSmartAccount({
      // @ts-expect-error - Type incompatibility between viem versions
      client: web3.publicClient,
      implementation: Implementation.MultiSig,
      deployParams: [signers, BigInt(threshold)],
      deploySalt,
      signatory: [{ account: tacoAccount }],
    });

    return { smartAccount, threshold };
  }

  /**
   * Internal helper to sign a prepared UserOperation using TACo.
   */
  private async signUserOpWithTaco(userOp: Record<string, unknown>) {
    const { chainKey, discordContext } = userOp as {
      chainKey?: SupportedChainKey;
      discordContext?: {
        timestamp: string;
        signature: string;
        payload: string;
      };
    };

    if (!chainKey) {
      throw new Error('Missing chain key when signing UserOperation with TACo');
    }

    if (!discordContext) {
      throw new Error('Missing Discord context when signing UserOperation with TACo');
    }

    const web3 = Web3Service.getInstance(chainKey);
    const chainConfig = CHAIN_CONFIG[chainKey];

    // Mirror demo script logging to make debugging TACo domain/cohort issues easier.
    console.log(
      `[TACo] Fetching signing context from cohort... Domain: ${chainConfig.tacoDomain}, Cohort: ${chainConfig.cohortId}, Chain: ${chainConfig.chainId}`,
    );

    // Normalize Discord signature: TACo conditions expect raw hex without `0x` prefix.
    const normalizedSignature = discordContext.signature.replace(/^0x/, '');

    const signingContext = await conditions.context.ConditionContext.forSigningCohort(
      web3.signingCoordinatorProvider,
      chainConfig.tacoDomain,
      chainConfig.cohortId,
      chainConfig.chainId,
    );

    (signingContext as any).customContextParameters = {
      ':timestamp': discordContext.timestamp,
      ':signature': normalizedSignature,
      ':discordPayload': discordContext.payload,
    };

    // Lightweight debug log – avoid dumping full signingContext to keep logs clean.
    console.log('[TACo] Signing context ready with custom parameters:', {
      ':timestamp': discordContext.timestamp,
      ':signature': normalizedSignature.slice(0, 10) + '...',
    });

    return await signUserOp(
      web3.signingCoordinatorProvider,
      chainConfig.tacoDomain,
      chainConfig.cohortId,
      chainConfig.chainId,
      userOp as UserOperationToSign,
      this.AA_VERSION,
      signingContext,
    );
  }
}
