import { Request, Response } from 'express';
import { TacoService } from '../services/taco.service';
import { getChainKeyFromRequest } from '../utils/chain';
import { getTxExplorerBaseUrl } from '../utils/explorer';
import { getUserFriendlyError, HttpError } from '../utils/errors';
import { TOKEN_SYMBOL } from '../config/tokens';

export class ExecuteController {
  static async execute(req: Request, res: Response) {
    try {
      const {
        userId,
        to,
        amountEth,
        amount,
        discordTimestamp,
        discordSignature,
        discordPayload,
        tokenSymbol,
        senderWalletAddress,
      } = req.body;
      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      if (!to) {
        res.status(400).json({ error: 'receiver address (to) is required' });
        return;
      }

      const tokenToUse = String(tokenSymbol ?? TOKEN_SYMBOL.ETH);
      const amountToUse = String(amount ?? amountEth ?? '');
      if (!amountToUse) {
        res.status(400).json({ error: 'amount (or amountEth) is required' });
        return;
      }

      if (!discordTimestamp || !discordSignature || !discordPayload) {
        res.status(400).json({
          error:
            'discordTimestamp, discordSignature, and discordPayload are required for TACo Discord-verified execution',
        });
        return;
      }

      const tacoService = TacoService.getInstance();
      const chainKey = getChainKeyFromRequest(req);

      // Preflight: check sender SMART ACCOUNT balance (not EOA wallet) before attempting execution.
      // 1) getBalance() call at start
      const preflight = await tacoService.validateTip({
        userId: String(userId),
        chain: chainKey,
        amount: amountToUse,
        tokenSymbol: tokenToUse,
        discordPayload: String(discordPayload),
      });

      // 2) if (balance < required) return error
      if (!preflight.sufficient) {
        res.status(400).json({
          error: `Your balance is insufficient to send a tip of ${preflight.amount} ${preflight.tokenSymbol}. Current balance: ${preflight.balance} ${preflight.tokenSymbol}.`,
          chain: chainKey,
          senderSmartAccount: preflight.smartAccountAddress,
          tokenSymbol: preflight.tokenSymbol,
          requestedAmount: preflight.amount,
          currentBalance: preflight.balance,
          note:
            preflight.tokenSymbol === TOKEN_SYMBOL.ETH
              ? 'ETH transfers also require additional ETH for gas.'
              : undefined,
          // keep senderWalletAddress if callers rely on it
          senderWalletAddress,
        });
        return;
      }

      const result = await tacoService.transferFromSmartAccount({
        userId: String(userId),
        to,
        amount: amountToUse,
        tokenSymbol: tokenToUse,
        chain: chainKey,
        discordContext: {
          timestamp: discordTimestamp,
          signature: discordSignature,
          payload: discordPayload,
        },
      });

      const explorerBase = getTxExplorerBaseUrl(chainKey);
      const transactionExplorerUrl = explorerBase
        ? `${explorerBase}${result.transactionHash}`
        : null;

      res.json({
        status: 'submitted',
        message: 'Execution started',
        chain: chainKey,
        senderSmartAccount: result.smartAccountAddress,
        receiver: result.to,
        amount: result.amount,
        tokenSymbol: result.tokenSymbol,
        userOpHash: result.userOpHash,
        transactionHash: result.transactionHash,
        transactionExplorerUrl,
      });
    } catch (error) {
      console.error(error);
      const tokenToUse = String(
        (req.body as any)?.tokenSymbol ?? (req.body as any)?.token ?? TOKEN_SYMBOL.ETH,
      );

      const body: Record<string, unknown> = {
        error: getUserFriendlyError(error, tokenToUse),
      };

      const status = error instanceof HttpError ? error.statusCode : 500;
      res.status(status).json(body);
    }
  }
}
