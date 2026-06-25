import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

/**
 * POST /api/webhooks/endpoints
 * Register a webhook endpoint for a merchant.
 * Body: { merchant: string; url: string }
 */
router.post('/endpoints', async (req: Request, res: Response) => {
  const { merchant, url } = req.body ?? {};
  if (!merchant || !url) {
    return res.status(400).json({ error: 'merchant and url are required' });
  }
  try {
    new URL(url); // validate URL format
  } catch {
    return res.status(400).json({ error: 'url is not a valid URL' });
  }

  try {
    const endpoint = await prisma.webhookEndpoint.upsert({
      where: { merchant_url: { merchant, url } },
      update: { active: true },
      create: { merchant, url, active: true },
    });
    res.status(201).json(endpoint);
  } catch (err) {
    res.status(500).json({ error: 'Failed to register endpoint' });
  }
});

/**
 * DELETE /api/webhooks/endpoints
 * Deactivate a webhook endpoint.
 * Body: { merchant: string; url: string }
 */
router.delete('/endpoints', async (req: Request, res: Response) => {
  const { merchant, url } = req.body ?? {};
  if (!merchant || !url) {
    return res.status(400).json({ error: 'merchant and url are required' });
  }
  try {
    await prisma.webhookEndpoint.updateMany({
      where: { merchant, url },
      data: { active: false },
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to deactivate endpoint' });
  }
});

/**
 * GET /api/webhooks/deliveries/:merchant
 * Return recent delivery log for a merchant.
 */
router.get('/deliveries/:merchant', async (req: Request, res: Response) => {
  try {
    const deliveries = await prisma.webhookDelivery.findMany({
      where: { merchant: req.params.merchant },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(deliveries);
  } catch {
    res.status(500).json({ error: 'Failed to fetch deliveries' });
  }
});

export default router;
