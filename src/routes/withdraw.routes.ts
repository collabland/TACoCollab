import { Router } from 'express';
import { ExecuteController } from '../controllers/execute.controller';

export const withdrawRouter = Router();

// New withdraw API (root path)
withdrawRouter.post('/', ExecuteController.withdraw);
