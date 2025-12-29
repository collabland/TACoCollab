import { Request, Response } from 'express';
import { DiscordInteractionPayload } from '../types/discord';

export class ExecuteController {
  static async execute(req: Request, res: Response) {
    try {
      const { discordPayload } = req.body as { discordPayload?: DiscordInteractionPayload };

      if (!discordPayload) {
        res.status(400).json({ error: 'discordPayload is required' });
        return;
      }

      // TODO: Implement orchestration of transaction execution using the Discord payload.
      // This will involve constructing and signing UserOperations in future tasks.

      res.json({
        status: 'pending',
        message: 'Execution started',
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Failed to start execution' });
    }
  }
}
