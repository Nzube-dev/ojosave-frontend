/**
 * reconciler.test.ts
 *
 * Tests for backend reconciliation logic.
 * Scenarios covered:
 *  1. No events, empty DB → nothing to do
 *  2. Missing record — subscribe event with no DB row → insert
 *  3. Inconsistent record — stored amount differs from chain → update
 *  4. Stale next_payment — executed event not reflected → update
 *  5. Cancel on existing record → delete
 *  6. DB row with no chain history (orphan) → error surfaced
 *  7. executed event before any subscribe → error surfaced, no crash
 *  8. Full lifecycle: subscribe → execute → cancel
 *  9. Re-subscribe after cancel → inserts fresh record
 * 10. Already in sync → zero repairs
 */

import { reconcile } from './reconciler';
import type {
  ChainEvent,
  StoredSubscription,
  SubscriptionDB,
} from './reconciler';

// ─── In-memory DB fixture ─────────────────────────────────────────────────────

function makeDB(initial: StoredSubscription[] = []): SubscriptionDB {
  const store = new Map<string, StoredSubscription>(
    initial.map((r) => [`${r.subscriber}:${r.merchant}`, r]),
  );
  return {
    get:    (s, m) => store.get(`${s}:${m}`),
    upsert: (r) => { store.set(`${r.subscriber}:${r.merchant}`, r); },
    delete: (s, m) => { store.delete(`${s}:${m}`); },
    all:    () => [...store.values()],
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SUB  = 'GAAA';
const MER  = 'GBBB';
const AMT  = 100_000n;
const IVL  = 86_400;
const T0   = 1_700_000_000;

const subscribeEvent = (overrides?: Partial<ChainEvent>): ChainEvent => ({
  type:       'subscribe',
  subscriber: SUB,
  merchant:   MER,
  amount:     AMT,
  timestamp:  T0,
  ...overrides,
});

const executedEvent = (overrides?: Partial<ChainEvent>): ChainEvent => ({
  type:       'executed',
  subscriber: SUB,
  merchant:   MER,
  amount:     AMT,
  timestamp:  T0 + IVL + 1,
  ...overrides,
});

const cancelEvent = (overrides?: Partial<ChainEvent>): ChainEvent => ({
  type:       'cancel',
  subscriber: SUB,
  merchant:   MER,
  amount:     0n,
  timestamp:  T0 + IVL * 2,
  ...overrides,
});

const storedRecord = (overrides?: Partial<StoredSubscription>): StoredSubscription => ({
  subscriber:      SUB,
  merchant:        MER,
  amount:          AMT,
  interval:        IVL,
  next_payment:    T0 + IVL,
  last_payment_at: null,
  ...overrides,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('reconcile()', () => {
  // 1
  test('empty events + empty DB → no repairs, no errors', () => {
    const result = reconcile([], makeDB());
    expect(result.repairs).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  // 2
  test('missing record: subscribe event but no DB row → inserts', () => {
    const db = makeDB();
    const result = reconcile([subscribeEvent()], db, IVL);

    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0].kind).toBe('insert');
    expect(result.errors).toHaveLength(0);

    // DB must now contain the correct record.
    const stored = db.get(SUB, MER);
    expect(stored).toBeDefined();
    expect(stored!.amount).toBe(AMT);
    expect(stored!.next_payment).toBe(T0 + IVL);
    expect(stored!.last_payment_at).toBeNull();
  });

  // 3
  test('inconsistent record: stored amount differs → updates', () => {
    const wrong = storedRecord({ amount: 999n });
    const db = makeDB([wrong]);

    const result = reconcile([subscribeEvent()], db, IVL);

    expect(result.repairs).toHaveLength(1);
    const repair = result.repairs[0];
    expect(repair.kind).toBe('update');
    if (repair.kind === 'update') {
      expect(repair.previous.amount).toBe(999n);
      expect(repair.next.amount).toBe(AMT);
    }
    expect(db.get(SUB, MER)!.amount).toBe(AMT);
  });

  // 4
  test('stale next_payment: executed event not reflected in DB → updates', () => {
    // DB has the post-subscribe state, but the executed event has since occurred.
    const stale = storedRecord({
      next_payment:    T0 + IVL,
      last_payment_at: null,
    });
    const db = makeDB([stale]);

    const result = reconcile([subscribeEvent(), executedEvent()], db, IVL);

    expect(result.repairs).toHaveLength(1);
    const repair = result.repairs[0];
    expect(repair.kind).toBe('update');
    if (repair.kind === 'update') {
      expect(repair.next.last_payment_at).toBe(T0 + IVL + 1);
      expect(repair.next.next_payment).toBe(T0 + IVL + 1 + IVL);
    }
  });

  // 5
  test('cancel event with existing DB record → deletes record', () => {
    const db = makeDB([storedRecord()]);

    const result = reconcile(
      [subscribeEvent(), cancelEvent()],
      db, IVL,
    );

    const deleteRepair = result.repairs.find((r) => r.kind === 'delete');
    expect(deleteRepair).toBeDefined();
    expect(db.get(SUB, MER)).toBeUndefined();
    expect(result.errors).toHaveLength(0);
  });

  // 6
  test('orphan DB record with no chain events → surfaces error', () => {
    const db = makeDB([storedRecord()]);
    const result = reconcile([], db);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/orphan/i);
    expect(result.errors[0]).toContain(`${SUB}:${MER}`);
    // Orphan detection does NOT auto-delete; only errors are reported.
    expect(db.get(SUB, MER)).toBeDefined();
  });

  // 7
  test('executed event before any subscribe → surfaces error, no crash', () => {
    const db = makeDB();
    const result = reconcile([executedEvent()], db, IVL);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/no preceding subscribe/i);
    expect(result.repairs).toHaveLength(0);
  });

  // 8
  test('full lifecycle: subscribe → execute → cancel', () => {
    const db = makeDB();

    const result = reconcile(
      [subscribeEvent(), executedEvent(), cancelEvent()],
      db, IVL,
    );

    // Final state = cancelled, so the record should have been inserted then deleted.
    const insertRepair = result.repairs.find((r) => r.kind === 'insert');
    const deleteRepair = result.repairs.find((r) => r.kind === 'delete');
    // The reconciler derives FINAL expected state: cancelled.
    // So only a delete repair should exist if there was no initial DB row.
    // (insert path skipped because expected final state is null)
    expect(deleteRepair).toBeUndefined(); // DB was empty; nothing to delete
    expect(insertRepair).toBeUndefined(); // Expected state is null (cancelled), so no insert
    expect(db.get(SUB, MER)).toBeUndefined();
    expect(result.errors).toHaveLength(0);
  });

  // 9
  test('cancel then re-subscribe → inserts fresh record', () => {
    const db = makeDB();
    const t2  = T0 + IVL * 3;

    const result = reconcile(
      [subscribeEvent(), cancelEvent(), subscribeEvent({ timestamp: t2, amount: 200_000n })],
      db, IVL,
    );

    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0].kind).toBe('insert');
    const stored = db.get(SUB, MER);
    expect(stored).toBeDefined();
    expect(stored!.amount).toBe(200_000n);
    expect(stored!.next_payment).toBe(t2 + IVL);
  });

  // 10
  test('already in sync → zero repairs', () => {
    // DB already reflects what the subscribe event says.
    const db = makeDB([storedRecord()]);
    const result = reconcile([subscribeEvent()], db, IVL);

    expect(result.repairs).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  // Edge: multiple independent subscriptions reconciled together
  test('multiple subscriber/merchant pairs reconciled independently', () => {
    const OTHER_SUB = 'GCCC';
    const db = makeDB();

    const result = reconcile(
      [
        subscribeEvent(),                                              // SUB→MER missing
        subscribeEvent({ subscriber: OTHER_SUB, timestamp: T0 + 1 }), // OTHER_SUB→MER missing
      ],
      db, IVL,
    );

    expect(result.repairs).toHaveLength(2);
    expect(result.repairs.every((r) => r.kind === 'insert')).toBe(true);
    expect(db.get(SUB, MER)).toBeDefined();
    expect(db.get(OTHER_SUB, MER)).toBeDefined();
  });
});
