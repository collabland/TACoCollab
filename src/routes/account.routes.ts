import { Router } from 'express';
import { AccountController } from '../controllers/account.controller';

export const accountRouter = Router();

accountRouter.post('/', AccountController.createAccount);
accountRouter.get('/:address/balance', AccountController.getBalance);
