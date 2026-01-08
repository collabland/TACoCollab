import { Implementation, toMetaMaskSmartAccount } from '@metamask/delegation-toolkit';
import { SigningCoordinatorAgent } from '@nucypher/shared';
import { conditions, domains, initialize, signUserOp, UserOperationToSign } from '@nucypher/taco';
import { ethers } from 'ethers';
import { Address } from 'viem';
import { createViemTacoAccount } from '../utils/taco-account';
import { Web3Service } from './web3.service';
import { CHAIN_CONFIG, SupportedChainKey } from '../config/chains';

export class TacoService {
  private static instance: TacoService;
  private initialized = false;
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
    const { chain } = params;
    const web3 = Web3Service.getInstance(chain);
    const { smartAccount } = await this.getSmartAccount(params.userId, chain);
    const value = ethers.utils.parseEther(params.amount);
    const baseGasPrice = await web3.publicClient.getGasPrice();

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
          to: params.to,
          value: BigInt(value.toString()),
        },
      ],
      ...fee,
      verificationGasLimit: BigInt(500_000),
    });
    const signature = await this.signUserOpWithTaco({
      ...(userOp as Record<string, unknown>),
      chainKey: chain,
      discordContext: params.discordContext,
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
      to: params.to,
      amount: params.amount,
      userOpHash,
      transactionHash: receipt.transactionHash,
    };
  }

  /**
   * Internal helper to derive (or counterfactually create) the TACo smart account.
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

    const smartAccount = await toMetaMaskSmartAccount({
      // @ts-expect-error - Type incompatibility between viem versions
      client: web3.publicClient,
      implementation: Implementation.MultiSig,
      deployParams: [signers, BigInt(threshold)],
      deploySalt: ethers.utils.id(userId) as `0x${string}`,
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

    const signingContext = await conditions.context.ConditionContext.forSigningCohort(
      web3.signingCoordinatorProvider,
      chainConfig.tacoDomain,
      chainConfig.cohortId,
      chainConfig.chainId,
    );

    (signingContext as any).customContextParameters = {
      ':timestamp': discordContext.timestamp,
      ':signature': discordContext.signature,
      ':discordPayload': discordContext.payload,
    };

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
