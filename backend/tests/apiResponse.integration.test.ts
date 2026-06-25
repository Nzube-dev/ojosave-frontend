/**
 * apiResponse.integration.test.ts
 *
 * Integration tests for the /api/summaries express router.
 * Spins up the router in-process with an in-memory Prisma client.
 * Uses Node's built-in http.request — no extra test dependencies.
 */

import http from 'http';
import express from 'express';
import summariesRouter from '../../src/routes/summaries';
import { InMemoryPrismaClient } from '../helpers/inMemoryDb';

// Inject in-memory Prisma before the router module is evaluated
jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: new (require('../helpers/inMemoryDb').InMemoryPrismaClient)(),
}));

import prisma from '../../src/lib/prisma';
const db = prisma as unknown as InMemoryPrismaClient;

// ── Helpers ───────────────────────────────────────────────────────────────────

function get(url: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: raw });
        }
      });
    }).on('error', reject);
  });
}

// ── Test server lifecycle ─────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/api/summaries', summariesRouter);
  server = app.listen(0, '127.0.0.1', () => {
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
    done();
  });
});

afterAll((done) => server.close(done));

beforeEach(() => db.reset());

// ── Tests ─────────────────────────────────────────────────────────────────────

const MERCHANT = 'GMERCHANT0000001';

describe('GET /api/summaries/merchant/:merchantAddress', () => {
  it('returns 200 with an empty array when no summaries exist', async () => {
    const { status, body } = await get(`${baseUrl}/api/summaries/merchant/${MERCHANT}`);
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it('returns summaries for the requested merchant', async () => {
    const start = new Date('2024-01-01');
    const end   = new Date('2024-01-01T23:59:59');

    await db.payoutSummary.create({
      data: { merchant: MERCHANT, startDate: start, endDate: end, totalAmount: '5000', paymentCount: 3, currency: 'CTOKEN', type: 'daily' },
    });
    await db.payoutSummary.create({
      data: { merchant: 'GOTHER', startDate: start, endDate: end, totalAmount: '9000', paymentCount: 1, currency: 'CTOKEN', type: 'daily' },
    });

    const { status, body } = await get(`${baseUrl}/api/summaries/merchant/${MERCHANT}`);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    const summaries = body as Array<{ merchant: string }>;
    expect(summaries.every((s) => s.merchant === MERCHANT)).toBe(true);
    expect(summaries).toHaveLength(1);
  });

  it('filters by type query param', async () => {
    const start = new Date('2024-01-01');
    const end   = new Date('2024-01-07T23:59:59');

    await db.payoutSummary.create({
      data: { merchant: MERCHANT, startDate: start, endDate: end, totalAmount: '1000', paymentCount: 1, currency: 'CTOKEN', type: 'daily' },
    });
    await db.payoutSummary.create({
      data: { merchant: MERCHANT, startDate: start, endDate: end, totalAmount: '7000', paymentCount: 7, currency: 'CTOKEN', type: 'weekly' },
    });

    const { status, body } = await get(`${baseUrl}/api/summaries/merchant/${MERCHANT}?type=weekly`);
    expect(status).toBe(200);
    const summaries = body as Array<{ type: string }>;
    expect(summaries).toHaveLength(1);
    expect(summaries[0].type).toBe('weekly');
  });
});

describe('GET /api/summaries/:id', () => {
  it('returns 200 with the summary when it exists', async () => {
    const created = await db.payoutSummary.create({
      data: {
        merchant: MERCHANT, startDate: new Date(), endDate: new Date(),
        totalAmount: '2000', paymentCount: 2, currency: 'CTOKEN', type: 'daily',
      },
    });

    const { status, body } = await get(`${baseUrl}/api/summaries/${created.id}`);
    expect(status).toBe(200);
    expect((body as { id: number }).id).toBe(created.id);
  });

  it('returns 404 for an unknown ID', async () => {
    const { status } = await get(`${baseUrl}/api/summaries/99999`);
    expect(status).toBe(404);
  });
});
