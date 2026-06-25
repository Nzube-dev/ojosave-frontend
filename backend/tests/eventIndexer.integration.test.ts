/**
 * eventIndexer.integration.test.ts
 *
 * Integration tests for PayoutSummaryGenerator.
 * Uses InMemoryPrismaClient injected via dependency inversion.
 *
 * The EventIndexer calls `this.server.getEvents()` against a live Soroban RPC,
 * which requires the stellar-sdk network stack. Those are covered in
 * contractCalls.integration.test.ts via the reconciler. Here we test the
 * downstream behaviour: that events stored in the DB are correctly aggregated
 * into payout summaries.
 */

import { PayoutSummaryGenerator } from '../../src/services/payoutSummaryGenerator';
import { InMemoryPrismaClient } from '../helpers/inMemoryDb';

// Inject the in-memory client by patching the module import the service uses.
jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: new (require('../helpers/inMemoryDb').InMemoryPrismaClient)(),
}));

// Re-import the mocked prisma so we can seed it
import prisma from '../../src/lib/prisma';
const db = prisma as unknown as InMemoryPrismaClient;

const MERCHANT = 'GMERCHANT0000001';
const TOKEN    = 'CTOKEN0000000001';

beforeEach(() => db.reset());

describe('generateDailySummaries', () => {
  const generator = new PayoutSummaryGenerator();

  it('creates a summary aggregating all executed events for the day', async () => {
    const today = new Date();
    db.seedEvents([
      { type: 'executed', subscriber: 'GSUB1', merchant: MERCHANT, token: TOKEN, amount: '1000', ledgerTimestamp: 1n },
      { type: 'executed', subscriber: 'GSUB2', merchant: MERCHANT, token: TOKEN, amount: '2000', ledgerTimestamp: 2n },
      // Different merchant — should not be included in this merchant's summary
      { type: 'executed', subscriber: 'GSUB3', merchant: 'GOTHER', token: TOKEN, amount: '9999', ledgerTimestamp: 3n },
    ]);

    await generator.generateDailySummaries(today);

    const summaries = await db.payoutSummary.findMany({ where: { merchant: MERCHANT } });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].totalAmount).toBe('3000');
    expect(summaries[0].paymentCount).toBe(2);
    expect(summaries[0].type).toBe('daily');
    expect(summaries[0].currency).toBe(TOKEN);
  });

  it('creates separate summaries per token when merchant receives multiple tokens', async () => {
    const TOKEN2 = 'CTOKEN0000000002';
    const today = new Date();
    db.seedEvents([
      { type: 'executed', subscriber: 'GSUB1', merchant: MERCHANT, token: TOKEN,  amount: '500', ledgerTimestamp: 1n },
      { type: 'executed', subscriber: 'GSUB2', merchant: MERCHANT, token: TOKEN2, amount: '750', ledgerTimestamp: 2n },
    ]);

    await generator.generateDailySummaries(today);

    const summaries = await db.payoutSummary.findMany({ where: { merchant: MERCHANT } });
    expect(summaries).toHaveLength(2);
    const tokens = summaries.map((s) => s.currency).sort();
    expect(tokens).toEqual([TOKEN, TOKEN2].sort());
  });

  it('updates an existing summary instead of creating a duplicate', async () => {
    const today = new Date();
    db.seedEvents([
      { type: 'executed', subscriber: 'GSUB1', merchant: MERCHANT, token: TOKEN, amount: '100', ledgerTimestamp: 1n },
    ]);

    await generator.generateDailySummaries(today);
    // Seed a second event and regenerate — should update, not duplicate
    db.seedEvents([
      { type: 'executed', subscriber: 'GSUB2', merchant: MERCHANT, token: TOKEN, amount: '200', ledgerTimestamp: 2n },
    ]);
    await generator.generateDailySummaries(today);

    const summaries = await db.payoutSummary.findMany({ where: { merchant: MERCHANT } });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].totalAmount).toBe('300');
  });

  it('does nothing when there are no executed events', async () => {
    await generator.generateDailySummaries(new Date());

    const summaries = await db.payoutSummary.findMany();
    expect(summaries).toHaveLength(0);
  });
});

describe('generateWeeklySummaries', () => {
  const generator = new PayoutSummaryGenerator();

  it('creates a weekly summary with correct type', async () => {
    const today = new Date();
    db.seedEvents([
      { type: 'executed', subscriber: 'GSUB1', merchant: MERCHANT, token: TOKEN, amount: '5000', ledgerTimestamp: 1n },
    ]);

    await generator.generateWeeklySummaries(today);

    const summaries = await db.payoutSummary.findMany({ where: { merchant: MERCHANT } });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].type).toBe('weekly');
  });
});
