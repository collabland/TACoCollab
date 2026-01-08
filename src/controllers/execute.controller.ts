import { Request, Response } from 'express';
import { TacoService } from '../services/taco.service';
import { getChainKeyFromRequest } from '../utils/chain';

export class ExecuteController {
  static async execute(req: Request, res: Response) {
    try {
      const { userId, to, amountEth, discordTimestamp, discordSignature, discordPayload } =
        req.body;
      console.log('req.body', req.body);
      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      if (!to) {
        res.status(400).json({ error: 'receiver address (to) is required' });
        return;
      }

      if (!amountEth) {
        res.status(400).json({ error: 'amountEth is required' });
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
      const result = await tacoService.transferFromSmartAccount({
        userId: String(userId),
        to,
        amount: amountEth,
        chain: chainKey,
        discordContext: {
          timestamp: String(discordTimestamp),
          signature: String(discordSignature),
          payload:
            typeof discordPayload === 'string' ? discordPayload : JSON.stringify(discordPayload),
        },
      });

      res.json({
        status: 'submitted',
        message: 'Execution started',
        senderSmartAccount: result.smartAccountAddress,
        receiver: result.to,
        amountEth: result.amount,
        userOpHash: result.userOpHash,
        transactionHash: result.transactionHash,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to start execution' });
    }
  }
}
