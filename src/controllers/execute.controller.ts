import { Request, Response } from 'express';
import { TacoService } from '../services/taco.service';

export class ExecuteController {
  static async execute(req: Request, res: Response) {
    try {
      const { userId, to, amountEth } = req.body;
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

      const tacoService = TacoService.getInstance();

      const result = await tacoService.transferFromSmartAccount({
        userId: String(userId),
        to,
        amountEth,
      });

      res.json({
        status: 'submitted',
        message: 'Execution started',
        senderSmartAccount: result.smartAccountAddress,
        receiver: result.to,
        amountEth: result.amountEth,
        userOpHash: result.userOpHash,
        transactionHash: result.transactionHash,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to start execution' });
    }
  }
}
