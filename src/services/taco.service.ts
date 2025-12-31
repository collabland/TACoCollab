import { Implementation, toMetaMaskSmartAccount } from '@metamask/delegation-toolkit';
import { SigningCoordinatorAgent } from '@nucypher/shared';
import { conditions, domains, initialize, signUserOp, UserOperationToSign } from '@nucypher/taco';
import { ethers } from 'ethers';
import { Address, parseEther } from 'viem';
import { createViemTacoAccount } from '../utils/taco-account';
import { Web3Service } from './web3.service';

export class TacoService {
  private static instance: TacoService;
  private initialized = false;
  private readonly TACO_DOMAIN = domains.DEVNET;
  private readonly COHORT_ID = 1;
  private readonly TACO_SIGNING_COORDINATOR_CHILD_ADDRESS =
    '0xcc537b292d142dABe2424277596d8FFCC3e6A12D';
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

  public async createSmartAccount(userId: string) {
    const { smartAccount, threshold } = await this.getSmartAccount(userId);

    return {
      address: (smartAccount as { address: string }).address,
      threshold,
      deployed: false,
    };
  }

  public async transferFromSmartAccount(params: {
    userId: string;
    to: Address;
    amountEth: string;
  }): Promise<{
    smartAccountAddress: string;
    to: string;
    amountEth: string;
    userOpHash: string;
    transactionHash: string;
  }> {
    await this.initializeTaco();
    const web3 = Web3Service.getInstance();
    const { smartAccount } = await this.getSmartAccount(params.userId);
    const value = ethers.utils.parseEther(params.amountEth);
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
    const signature = await this.signUserOpWithTaco(userOp as Record<string, unknown>);
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
      amountEth: params.amountEth,
      userOpHash,
      transactionHash: receipt.transactionHash,
    };
  }

  /**
   * Internal helper to derive (or counterfactually create) the TACo smart account.
   */
  private async getSmartAccount(
    userId: string,
  ): Promise<{ smartAccount: unknown; threshold: number }> {
    await this.initializeTaco();
    const web3 = Web3Service.getInstance();

    // Fetch cohort multisig
    const coordinator = new ethers.Contract(
      this.TACO_SIGNING_COORDINATOR_CHILD_ADDRESS,
      ['function cohortMultisigs(uint32) view returns (address)'],
      web3.signingChainProvider,
    );
    const cohortMultisigAddress = await coordinator.cohortMultisigs(this.COHORT_ID);

    // Fetch participants/threshold
    const participants = await SigningCoordinatorAgent.getParticipants(
      web3.signingCoordinatorProvider,
      this.TACO_DOMAIN,
      this.COHORT_ID,
    );
    const threshold = await SigningCoordinatorAgent.getThreshold(
      web3.signingCoordinatorProvider,
      this.TACO_DOMAIN,
      this.COHORT_ID,
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
    const web3 = Web3Service.getInstance();

    const signingContext = await conditions.context.ConditionContext.forSigningCohort(
      web3.signingCoordinatorProvider,
      this.TACO_DOMAIN,
      this.COHORT_ID,
      Web3Service.BASE_SEPOLIA_CHAIN_ID,
    );

    return await signUserOp(
      web3.signingCoordinatorProvider,
      this.TACO_DOMAIN,
      this.COHORT_ID,
      Web3Service.BASE_SEPOLIA_CHAIN_ID,
      userOp as UserOperationToSign,
      this.AA_VERSION,
      signingContext,
    );
  }
}
