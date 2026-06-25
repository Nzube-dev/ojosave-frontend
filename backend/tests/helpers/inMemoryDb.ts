/**
 * inMemoryDb.ts
 *
 * Lightweight in-process stand-in for Prisma + PostgreSQL.
 * Implements only the methods exercised in integration tests.
 * Satisfies the SubscriptionDB interface from reconciler.ts.
 */

import type { SubscriptionDB, StoredSubscription } from '../../reconciler';

// ── In-memory subscription store ──────────────────────────────────────────────

export class InMemorySubscriptionDB implements SubscriptionDB {
  private store = new Map<string, StoredSubscription>();

  private key(subscriber: string, merchant: string) {
    return `${subscriber}:${merchant}`;
  }

  get(subscriber: string, merchant: string): StoredSubscription | undefined {
    return this.store.get(this.key(subscriber, merchant));
  }

  upsert(record: StoredSubscription): void {
    this.store.set(this.key(record.subscriber, record.merchant), record);
  }

  delete(subscriber: string, merchant: string): void {
    this.store.delete(this.key(subscriber, merchant));
  }

  all(): StoredSubscription[] {
    return [...this.store.values()];
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

// ── In-memory event/summary store (Prisma-compatible shapes) ─────────────────

export interface StoredEvent {
  id: number;
  type: string;
  subscriber: string;
  merchant: string;
  token: string | null;
  amount: string;
  ledgerTimestamp: bigint;
  createdAt: Date;
}

export interface StoredSummary {
  id: number;
  merchant: string;
  startDate: Date;
  endDate: Date;
  totalAmount: string;
  paymentCount: number;
  currency: string;
  type: string;
  createdAt: Date;
}

/** Minimal Prisma-compatible client for use in integration tests. */
export class InMemoryPrismaClient {
  private events: StoredEvent[] = [];
  private summaries: StoredSummary[] = [];
  private nextEventId = 1;
  private nextSummaryId = 1;

  event = {
    findFirst: async (args: { where: Partial<StoredEvent> }) => {
      return this.events.find((e) => this.matches(e, args.where)) ?? null;
    },
    findMany: async (args?: { where?: Partial<StoredEvent & { createdAt?: { gte?: Date; lte?: Date } }> }) => {
      if (!args?.where) return [...this.events];
      return this.events.filter((e) => {
        const { createdAt, ...rest } = args.where as any;
        if (!this.matches(e, rest)) return false;
        if (createdAt?.gte && e.createdAt < createdAt.gte) return false;
        if (createdAt?.lte && e.createdAt > createdAt.lte) return false;
        return true;
      });
    },
    create: async (args: { data: Omit<StoredEvent, 'id' | 'createdAt'> }) => {
      const record: StoredEvent = {
        ...args.data,
        id: this.nextEventId++,
        createdAt: new Date(),
      };
      this.events.push(record);
      return record;
    },
  };

  payoutSummary = {
    findFirst: async (args: { where: Partial<StoredSummary> }) => {
      return this.summaries.find((s) => this.matches(s, args.where)) ?? null;
    },
    findMany: async (args?: { where?: Partial<StoredSummary>; orderBy?: object }) => {
      if (!args?.where) return [...this.summaries];
      return this.summaries.filter((s) => this.matches(s, args.where!));
    },
    create: async (args: { data: Omit<StoredSummary, 'id' | 'createdAt'> }) => {
      const record: StoredSummary = {
        ...args.data,
        id: this.nextSummaryId++,
        createdAt: new Date(),
      };
      this.summaries.push(record);
      return record;
    },
    update: async (args: { where: { id: number }; data: Partial<StoredSummary> }) => {
      const idx = this.summaries.findIndex((s) => s.id === args.where.id);
      if (idx === -1) throw new Error(`Summary ${args.where.id} not found`);
      this.summaries[idx] = { ...this.summaries[idx], ...args.data };
      return this.summaries[idx];
    },
  };

  /** Seed events directly for test setup. */
  seedEvents(events: Omit<StoredEvent, 'id' | 'createdAt'>[]): void {
    for (const e of events) {
      this.events.push({ ...e, id: this.nextEventId++, createdAt: new Date() });
    }
  }

  reset(): void {
    this.events = [];
    this.summaries = [];
    this.nextEventId = 1;
    this.nextSummaryId = 1;
  }

  private matches(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (v === undefined) return true;
      return String(record[k]) === String(v);
    });
  }
}
