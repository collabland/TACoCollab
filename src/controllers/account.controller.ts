import { ethers } from 'ethers';
import { Request, Response } from 'express';
import { TacoService } from '../services/taco.service';
import { Web3Service } from '../services/web3.service';
import { getChainKeyFromRequest } from '../utils/chain';

export class AccountController {
  static async createAccount(req: Request, res: Response) {
    try {
      const { userId } = req.body;
      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }
      const chainKey = getChainKeyFromRequest(req);
      const service = TacoService.getInstance();
      const result = await service.createSmartAccount(userId, chainKey);
      res.json(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || 'Failed to create account' });
    }
  }

  static async getBalance(req: Request, res: Response) {
    try {
      const { address } = req.params;
      const chainKey = getChainKeyFromRequest(req);
      const web3 = Web3Service.getInstance(chainKey);
      const balance = await web3.signingChainProvider.getBalance(address);
      res.json({
        address,
        balance: ethers.utils.formatEther(balance),
        symbol: 'ETH',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
