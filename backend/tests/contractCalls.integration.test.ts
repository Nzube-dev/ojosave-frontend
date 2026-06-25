/**
 * contractCalls.integration.test.ts
 *
 * Integration tests for the reconciler's contract-call replay logic.
 * Uses InMemorySubscriptionDB — no real RPC or database required.
 */

import { reconcile, ChainEvent, SubscriptionDB } from '../../reconciler';
import { InMemorySubscriptionDB } from '../helpers/inMemoryDb';

const SUBSCRIBER = 'GABC1234';
const MERCHANT   = 'GXYZ5678';
const T0 = 1_700_000_000; // arbitrary unix timestamp
const INTERVAL = 86_400;  // 1 day

let db: InMemorySubscriptionDB;

beforeEach(() => {
  db = new InMemorySubscriptionDB();
});

describe('subscribe event', () => {
  it('inserts a new subscription when none exists', () => {
    const events: ChainEvent[] = [
      { type: 'subscribe', subscriber: SUBSCRIBER, merchant: MERCHANT, amount: 100n, timestamp: T0 },
    ];

    const { repairs, errors } = reconcile(events, db, INTERVAL);

    expect(errors).toHaveLength(0);
    expect(repairs).toHaveLength(1);
    expect(repairs[0].kind).toBe('insert');

    const stored = db.get(SUBSCRIBER, MERCHANT);
    expect(stored).toBeDefined();
    expect(stored!.amount).toBe(100n);
    expect(stored!.next_payment).toBe(T0 + INTERVAL);
  });

  it('updates subscription when amount changes on re-subscribe', () => {
    // Seed an existing record with old amount
    db.upsert({ subscriber: SUBSCRIBER, merchant: MERCHANT, amount: 50n, interval: INTERVAL, next_payment: T0 + INTERVAL, last_payment_at: null });

    const events: ChainEvent[] = [
      { type: 'subscribe', subscriber: SUBSCRIBER, merchant: MERCHANT, amount: 50n,  timestamp: T0 },
      { type: 'subscribe', subscriber: SUBSCRIBER, merchant: MERCHANT, amount: 200n, timestamp: T0 + 10 },
    ];

    const { repairs } = reconcile(events, db, INTERVAL);

    const updateRepair = repairs.find((r: any) => r.kind === 'update');
    expect(updateRepair).toBeDefined();
    expect(db.get(SUBSCRIBER, MERCHANT)!.amount).toBe(200n);
  });
});

describe('execute_payment event', () => {
  it('advances next_payment and sets last_payment_at', () => {
    const events: ChainEvent[] = [
      { type: 'subscribe', subscriber: SUBSCRIBER, merchant: MERCHANT, amount: 100n,  timestamp: T0 },
      { type: 'executed', subscriber: SUBSCRIBER, merchant: MERCHANT, amount: 100n,  timestamp: T0 + INTERVAL },
    ];

    reconcile(events, db, INTERVAL);

    const stored = db.get(SUBSCRIBER, MERCHANT);
    expect(stored!.last_payment_at).toBe(T0 + INTERVAL);
    expect(stored!.next_payment).toBe(T0 + INTERVAL * 2);
  });

  it('records an error for executed event without preceding subscribe', () => {
    const events: ChainEvent[] = [
      { type: 'executed', subscriber: SUBSCRIBER, merchant: MERCHANT, amount: 100n, timestamp: T0 },
    ];

    const { errors } = reconcile(events, db, INTERVAL);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/no preceding subscribe/i);
  });
});

describe('cancel event', () => {
  it('removes an existing subscription', () => {
    db.upsert({ subscriber: SUBSCRIBER, merchant: MERCHANT, amount: 100n, interval: INTERVAL, next_payment: T0 + INTERVAL, last_payment_at: null });

    const events: ChainEvent[] = [
      { type: 'subscribe', subscriber: SUBSCRIBER, merchant: MERCHANT, amount: 100n, timestamp: T0 },
      { type: 'cancel',    subscriber: SUBSCRIBER, merchant: MERCHANT, amount: 0n,   timestamp: T0 + 1 },
    ];

    const { repairs } = reconcile(events, db, INTERVAL);

    expect(db.get(SUBSCRIBER, MERCHANT)).toBeUndefined();
    expect(repairs.some((r) => r.kind === 'delete')).toBe(true);
  });
});

describe('orphan detection', () => {
  it('flags a DB record with no on-chain subscribe event', () => {
    db.upsert({ subscriber: 'GHOST', merchant: MERCHANT, amount: 1n, interval: INTERVAL, next_payment: T0, last_payment_at: null });

    const { errors } = reconcile([], db, INTERVAL);

    expect(errors.some((e: any) => e.includes('orphan'))).toBe(true);
  });
});
