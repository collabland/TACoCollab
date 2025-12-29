import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { accountRouter } from './routes/account.routes';
import { executeRouter } from './routes/execute.routes';

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

import { authMiddleware } from './middleware/auth.middleware';
app.use('/v1/account', authMiddleware, accountRouter);
app.use('/v1/execute', authMiddleware, executeRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;
