import { Router } from 'express';
import { ExecuteController } from '../controllers/execute.controller';

export const executeRouter = Router();

executeRouter.post('/', ExecuteController.execute);
