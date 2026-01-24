import { ethers } from 'ethers';
import { Request, Response } from 'express';
import { TacoService } from '../services/taco.service';
import { Web3Service } from '../services/web3.service';
import { getChainKeyFromRequest } from '../utils/chain';
import { getAddressExplorerBaseUrl } from '../utils/explorer';
import { CHAIN_CONFIG } from '../config/chains';
import { getTokenAddress, getTokenDecimals, TOKEN_SYMBOL } from '../config/tokens';

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
      const ethBalance = await web3.signingChainProvider.getBalance(address);

      const chainId = CHAIN_CONFIG[chainKey].chainId;
      const usdcAddress = await getTokenAddress(TOKEN_SYMBOL.USDC, chainId);
      const usdcDecimals = await getTokenDecimals(
        TOKEN_SYMBOL.USDC,
        usdcAddress,
        web3.signingChainProvider,
      );
      const usdcContract = new ethers.Contract(
        usdcAddress,
        ['function balanceOf(address) view returns (uint256)'],
        web3.signingChainProvider,
      );
      const usdcBalance = await usdcContract.balanceOf(address);

      const explorerBase = getAddressExplorerBaseUrl(chainKey);
      const addressExplorerUrl = explorerBase ? `${explorerBase}${address}` : null;
      const usdcExplorerUrl = explorerBase ? `${explorerBase}${usdcAddress}` : null;

      res.json({
        address,
        chain: chainKey,
        chainLabel: CHAIN_CONFIG[chainKey].label,
        chainId,
        addressExplorerUrl,
        tokens: {
          USDC: {
            address: usdcAddress,
            explorerUrl: usdcExplorerUrl,
          },
        },
        usdcAddress,
        ETH: ethers.utils.formatEther(ethBalance),
        USDC: ethers.utils.formatUnits(usdcBalance, usdcDecimals),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
