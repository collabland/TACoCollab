import { Implementation, toMetaMaskSmartAccount } from '@metamask/delegation-toolkit';
import { SigningCoordinatorAgent } from '@nucypher/shared';
import { conditions, initialize, signUserOp, UserOperationToSign } from '@nucypher/taco';
import { ethers } from 'ethers';
import { Address, encodeFunctionData } from 'viem';
import { CHAIN_CONFIG, SupportedChainKey } from '../config/chains';
import {
  getTokenAddress,
  getTokenDecimals,
  normalizeTokenSymbol,
  SupportedTokenSymbol,
  TOKEN_SYMBOL,
} from '../config/tokens';
import { createViemTacoAccount, getCollabLandId } from '../utils/taco-account';
import { Web3Service } from './web3.service';

const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

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
    tokenSymbol?: SupportedTokenSymbol | string;
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
    tokenSymbol: SupportedTokenSymbol;
    userOpHash: string;
    transactionHash: string;
  }> {
    await this.initializeTaco();

    const { chain, userId, to, amount, discordContext } = params;
    const web3 = Web3Service.getInstance(chain);
    const { smartAccount } = await this.getSmartAccount(userId, chain);

    // 1) Start with explicit API params
    let tokenSymbol: SupportedTokenSymbol = normalizeTokenSymbol(params.tokenSymbol);
    let transferAmountStr = amount;
    let callTarget: Address = to;

    // 2) Best-effort override amount/token/recipient from Discord payload (matches discord-taco-web behavior)
    const discordOverrides = this.tryParseDiscordExecuteOverrides(discordContext.payload);
    if (discordOverrides.amountStr) transferAmountStr = discordOverrides.amountStr;
    if (discordOverrides.tokenSymbol) tokenSymbol = discordOverrides.tokenSymbol;
    if (discordOverrides.receiverUserId) {
      const { smartAccount: recipientSmartAccount } = await this.getSmartAccount(
        discordOverrides.receiverUserId,
        chain,
      );
      callTarget = (recipientSmartAccount as { address: Address }).address;
    }

    // 3) Resolve token metadata & amount (decimals/address) for the signing chain
    const chainId = CHAIN_CONFIG[chain].chainId;
    const { tokenAddress, tokenDecimals } = await this.getTokenMetaForChain(
      tokenSymbol,
      chainId,
      web3.signingChainProvider,
    );
    const transferValue =
      tokenSymbol === TOKEN_SYMBOL.ETH
        ? ethers.utils.parseEther(transferAmountStr)
        : ethers.utils.parseUnits(transferAmountStr, tokenDecimals);

    // 4) Preflight balance checks:
    // - ERC20: ensure token balance exists
    // - ETH: ensure smart account has enough ETH to cover the transfer value
    if (tokenSymbol === TOKEN_SYMBOL.ETH) {
      await this.assertEthBalanceSufficient({
        provider: web3.signingChainProvider,
        smartAccountAddress: (smartAccount as { address: string }).address,
        requiredAmount: transferValue,
        requiredAmountDisplay: transferAmountStr,
      });
    } else {
      await this.assertErc20BalanceSufficient({
        provider: web3.signingChainProvider,
        tokenAddress: tokenAddress as Address,
        tokenDecimals,
        tokenSymbol,
        smartAccountAddress: (smartAccount as { address: string }).address,
        requiredAmount: transferValue,
        requiredAmountDisplay: transferAmountStr,
      });
    }

    const baseGasPrice = await web3.publicClient.getGasPrice();

    // Pimlico bundler enforces minimum gas prices
    // Use higher multipliers to ensure we meet Pimlico's requirements, especially on mainnet
    const MIN_PRIORITY_FEE = 1_000_000n;
    const suggestedPriorityFee = baseGasPrice / 10n;

    // Higher multiplier for mainnet to ensure we meet Pimlico's minimum gas price requirements
    const multiplier = chain === 'base-mainnet' ? 25n : 12n;

    const fee = {
      maxFeePerGas: (baseGasPrice * multiplier) / 10n,
      maxPriorityFeePerGas:
        suggestedPriorityFee < MIN_PRIORITY_FEE ? MIN_PRIORITY_FEE : suggestedPriorityFee,
    };

    const calls = this.buildUserOpCalls({
      tokenSymbol,
      tokenAddress,
      recipient: callTarget,
      amount: transferValue,
    });

    // Use higher gas limit for mainnet deployments (smart account creation requires more gas)
    const verificationGasLimit = chain === 'base-mainnet' ? BigInt(1_500_000) : BigInt(500_000);

    const userOp = await web3.bundlerClient.prepareUserOperation({
      account: smartAccount,
      calls,
      ...fee,
      verificationGasLimit,
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
      amount: transferAmountStr,
      tokenSymbol,
      userOpHash,
      transactionHash: receipt.transactionHash,
    };
  }

  private tryParseDiscordExecuteOverrides(payload: string): {
    amountStr?: string;
    tokenSymbol?: SupportedTokenSymbol;
    receiverUserId?: string;
  } {
    try {
      const parsed = JSON.parse(payload) as {
        data?: {
          options?: Array<{
            name?: string;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            options?: Array<{ name?: string; value?: any }>;
          }>;
        };
      };

      // NOTE: must compare both sides; `'send'` alone is always truthy.
      const executeCmd = parsed?.data?.options?.find(
        (o) => o?.name === 'execute' || o?.name === 'send',
      );
      const opts = executeCmd?.options ?? [];

      const amountOpt = opts.find((o) => o?.name === 'amount')?.value;
      const receiverOpt = opts.find((o) => o?.name === 'receiver')?.value;
      const tokenOpt = opts.find((o) => o?.name === 'token')?.value;

      return {
        amountStr: amountOpt !== undefined ? String(amountOpt) : undefined,
        tokenSymbol: tokenOpt !== undefined ? normalizeTokenSymbol(tokenOpt) : undefined,
        receiverUserId: receiverOpt ? String(receiverOpt) : undefined,
      };
    } catch (err) {
      console.warn('Failed to parse Discord payload overrides; using API params.', err);
      return {};
    }
  }

  private async assertEthBalanceSufficient(params: {
    provider: ethers.providers.JsonRpcProvider;
    smartAccountAddress: string;
    requiredAmount: ethers.BigNumber;
    requiredAmountDisplay: string;
  }): Promise<void> {
    const { provider, smartAccountAddress, requiredAmount, requiredAmountDisplay } = params;
    const currentBalance = await provider.getBalance(smartAccountAddress);
    if (currentBalance.lt(requiredAmount)) {
      throw new Error(
        `Insufficient ETH balance in smart account ${smartAccountAddress}. ` +
          `Have ${ethers.utils.formatEther(currentBalance)} ETH, ` +
          `need ${requiredAmountDisplay} ETH for the transfer value (gas may be additional).`,
      );
    }
  }

  private async getTokenMetaForChain(
    tokenSymbol: SupportedTokenSymbol,
    chainId: number,
    provider: ethers.providers.JsonRpcProvider,
  ): Promise<{ tokenAddress: Address | null; tokenDecimals: number }> {
    if (tokenSymbol === TOKEN_SYMBOL.ETH) return { tokenAddress: null, tokenDecimals: 18 };

    const tokenAddress = await getTokenAddress(tokenSymbol, chainId);
    const tokenDecimals = await getTokenDecimals(tokenSymbol, tokenAddress, provider);
    return { tokenAddress, tokenDecimals };
  }

  private async assertErc20BalanceSufficient(params: {
    provider: ethers.providers.JsonRpcProvider;
    tokenAddress: Address;
    tokenDecimals: number;
    tokenSymbol: SupportedTokenSymbol;
    smartAccountAddress: string;
    requiredAmount: ethers.BigNumber;
    requiredAmountDisplay: string;
  }): Promise<void> {
    const {
      provider,
      tokenAddress,
      tokenDecimals,
      tokenSymbol,
      smartAccountAddress,
      requiredAmount,
      requiredAmountDisplay,
    } = params;

    const tokenContract = new ethers.Contract(
      tokenAddress as string,
      ['function balanceOf(address) view returns (uint256)'],
      provider,
    );
    const currentBalance = (await tokenContract.balanceOf(smartAccountAddress)) as ethers.BigNumber;
    if (currentBalance.lt(requiredAmount)) {
      throw new Error(
        `Insufficient ${tokenSymbol} balance in smart account ${smartAccountAddress}. ` +
          `Have ${ethers.utils.formatUnits(currentBalance, tokenDecimals)} ${tokenSymbol}, ` +
          `need ${requiredAmountDisplay} ${tokenSymbol}.`,
      );
    }
  }

  private buildUserOpCalls(params: {
    tokenSymbol: SupportedTokenSymbol;
    tokenAddress: Address | null;
    recipient: Address;
    amount: ethers.BigNumber;
  }): Array<{ to: Address; value: bigint; data?: `0x${string}` }> {
    const { tokenSymbol, tokenAddress, recipient, amount } = params;

    if (tokenSymbol === TOKEN_SYMBOL.ETH) {
      return [
        {
          to: recipient,
          value: BigInt(amount.toString()),
        },
      ];
    }

    if (!tokenAddress) {
      throw new Error(`Missing token address for ERC20 transfer (${tokenSymbol})`);
    }

    return [
      {
        to: tokenAddress,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20_TRANSFER_ABI,
          functionName: 'transfer',
          args: [recipient, BigInt(amount.toString())],
        }),
      },
    ];
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
