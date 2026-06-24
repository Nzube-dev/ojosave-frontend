/**
 * reconciler.ts
 *
 * Compares on-chain event data with stored subscription records and repairs
 * any divergence (missing records, stale/wrong fields).
 *
 * On-chain truth:
 *   - A `subscribe` event means a subscription with (subscriber, merchant, amount)
 *     MUST exist in the DB.
 *   - A `cancel` removes the subscription; if a record exists it should be deleted.
 *   - An `executed` event updates last_payment_at and decrements next_payment.
 *
 * The reconciler replays the canonical event log and produces a RepairReport
 * listing every action taken (or that needs to be taken) to bring the DB into sync.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Event types emitted by the SubscriptionProtocol contract. */
export type EventType = 'subscribe' | 'executed' | 'cancel';

/** A single on-chain event as returned by a Soroban RPC event stream. */
export interface ChainEvent {
  type: EventType;
  subscriber: string;
  merchant: string;
  amount: bigint;   // present on subscribe / executed; 0n for cancel
  timestamp: number; // Unix seconds of the ledger that emitted the event
}

/** The stored state for one (subscriber, merchant) pair in the off-chain DB. */
export interface StoredSubscription {
  subscriber: string;
  merchant: string;
  amount: bigint;
  interval: number;       // seconds
  next_payment: number;   // Unix timestamp
  last_payment_at: number | null;
}

/** Minimal DB interface — keeps reconciler testable without a real database. */
export interface SubscriptionDB {
  get(subscriber: string, merchant: string): StoredSubscription | undefined;
  upsert(record: StoredSubscription): void;
  delete(subscriber: string, merchant: string): void;
  all(): StoredSubscription[];
}

/** One repair action recorded in the report. */
export type RepairAction =
  | { kind: 'insert'; record: StoredSubscription }
  | { kind: 'update'; previous: StoredSubscription; next: StoredSubscription }
  | { kind: 'delete'; subscriber: string; merchant: string };

export interface ReconcileResult {
  repairs: RepairAction[];
  errors: string[];
}

// ─── Reconciler ───────────────────────────────────────────────────────────────

/**
 * Reconcile the DB against the canonical chain event log.
 *
 * Events must be ordered oldest-first. The reconciler derives the expected
 * final state from the event log and diffs it against the DB, then applies
 * repairs via the db interface.
 */
export function reconcile(
  events: ChainEvent[],
  db: SubscriptionDB,
  defaultInterval = 86_400,
): ReconcileResult {
  const repairs: RepairAction[] = [];
  const errors: string[] = [];

  // 1. Derive expected state by replaying events (oldest → newest).
  //    Key: "subscriber:merchant"
  const expected = new Map<string, StoredSubscription | null>();

  for (const ev of events) {
    const key = `${ev.subscriber}:${ev.merchant}`;

    if (ev.type === 'subscribe') {
      const prev = expected.get(key);
      const interval =
        prev && prev !== null ? prev.interval : defaultInterval;
      expected.set(key, {
        subscriber: ev.subscriber,
        merchant: ev.merchant,
        amount: ev.amount,
        interval,
        next_payment: ev.timestamp + interval,
        last_payment_at: prev && prev !== null ? prev.last_payment_at : null,
      });
    } else if (ev.type === 'executed') {
      const cur = expected.get(key);
      if (!cur) {
        errors.push(
          `executed event for ${key} at t=${ev.timestamp} has no preceding subscribe`,
        );
        continue;
      }
      expected.set(key, {
        ...cur,
        amount: ev.amount,
        last_payment_at: ev.timestamp,
        next_payment: ev.timestamp + cur.interval,
      });
    } else if (ev.type === 'cancel') {
      expected.set(key, null); // null = should not exist in DB
    }
  }

  // 2. Diff expected vs stored.
  for (const [key, want] of expected.entries()) {
    const [subscriber, merchant] = key.split(':');
    const have = db.get(subscriber, merchant);

    if (want === null) {
      // Should be absent.
      if (have !== undefined) {
        db.delete(subscriber, merchant);
        repairs.push({ kind: 'delete', subscriber, merchant });
      }
    } else if (have === undefined) {
      // Missing record — insert.
      db.upsert(want);
      repairs.push({ kind: 'insert', record: want });
    } else if (!recordsMatch(have, want)) {
      // Exists but diverges — update.
      db.upsert(want);
      repairs.push({ kind: 'update', previous: have, next: want });
    }
    // else: already in sync, no action.
  }

  // 3. Detect DB records with no corresponding chain history (orphans).
  for (const stored of db.all()) {
    const key = `${stored.subscriber}:${stored.merchant}`;
    if (!expected.has(key)) {
      errors.push(
        `orphan record in DB for ${key} — no on-chain subscribe event found`,
      );
    }
  }

  return { repairs, errors };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function recordsMatch(a: StoredSubscription, b: StoredSubscription): boolean {
  return (
    a.amount === b.amount &&
    a.interval === b.interval &&
    a.next_payment === b.next_payment &&
    a.last_payment_at === b.last_payment_at
  );
}
