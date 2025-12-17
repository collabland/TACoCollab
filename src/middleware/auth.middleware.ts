import * as dotenv from 'dotenv';
import { NextFunction, Request, Response } from 'express';

dotenv.config();

const API_KEY = process.env.API_KEY;

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }

  next();
}
