import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

router.get('/merchant/:merchantAddress', async (req: Request, res: Response) => {
  try {
    const { merchantAddress } = req.params;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: { merchant: merchantAddress },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.auditLog.count({ where: { merchant: merchantAddress } }),
    ]);

    res.json({ data: logs, total, limit, offset });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

export default router;
