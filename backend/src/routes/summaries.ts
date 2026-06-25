import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// Get all summaries for a merchant
router.get('/merchant/:merchantAddress', async (req: Request, res: Response) => {
  try {
    const { merchantAddress } = req.params;
    const { type } = req.query; // Optional: filter by type (daily/weekly)

    const where: any = { merchant: merchantAddress };
    if (type) {
      where.type = type;
    }

    const summaries = await prisma.payoutSummary.findMany({
      where: where,
      orderBy: { createdAt: 'desc' },
    });

    res.json(summaries);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch summaries' });
  }
});

// Get a specific summary by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const summary = await prisma.payoutSummary.findUnique({
      where: { id: parseInt(id) },
    });

    if (!summary) {
      return res.status(404).json({ error: 'Summary not found' });
    }

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

export default router;
