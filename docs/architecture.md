# Backend Event-Indexing Architecture for SorobanPay

This document describes the recommended architecture for indexing and processing off-chain events from the SorobanPay smart contract. Contributors building integrations, dashboards, or payment analytics should use this guide to design a robust event processing pipeline.

---

## Table of Contents

1. [Event Sources](#event-sources)
2. [Event Schema](#event-schema)
3. [Storage Architecture](#storage-architecture)
4. [Indexing Patterns](#indexing-patterns)
5. [Example Workflows](#example-workflows)
6. [Implementation Considerations](#implementation-considerations)
7. [Error Handling & Resilience](#error-handling--resilience)

---

## Event Sources

SorobanPay emits two distinct event types. All events originate from the Soroban smart contract and are indexed via Soroban RPC's event stream.

### Event Type 1: `subscribe`

**When emitted:** After a subscription is successfully created or updated (i.e., new subscription data is persisted and TTL is set).

**Semantics:**
- Marks the **start** or **update** of a recurring payment relationship.
- The subscription is immediately active—the next payment window opens at `subscribe_ledger_time + interval`.
- If called with the same `(subscriber, merchant)` pair, it **replaces** the previous subscription (not idempotent in terms of data, but safe to call multiple times).

**Event Schema:**

| Component | Type | Description |
|-----------|------|-------------|
| **Topic[0]** | Symbol | Literal: `"subscribe"` |
| **Topic[1]** | Address | Subscriber Stellar account (G-address) |
| **Topic[2]** | Address | Merchant Stellar account (G-address) |
| **Data** | i128 | Payment amount in token's smallest unit (e.g., stroops for native asset) |

**Example (RPC response):**

```json
{
  "type": "contract",
  "ledger": 1_234_567,
  "ledger_close_time": "2025-06-24T10:30:00Z",
  "contract_id": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "id": "0000005314649600-0000000000",
  "topics": [
    "AAAADwAAAAhzdWJzY3JpYmU=",
    "AAAAAQB6Mcc...",
    "AAAAAQB9RwE..."
  ],
  "data": "AAAACgAAAAoAAAAAAYchIE",
  "in_successful_contract_invocation": true,
  "tx_hash": "1a2b3c4d5e6f7g8h..."
}
```

---

### Event Type 2: `executed`

**When emitted:** After a payment transfer is successfully completed and the subscription's `next_payment` timestamp is updated.

**Semantics:**
- Confirms that a recurring payment was **collected** from subscriber and **delivered** to merchant.
- The next payment window opens at `current_timestamp + interval` (captured at invocation start).
- If the contract's `token.transfer()` fails (insufficient allowance or balance), **no event is emitted** and the subscription remains unmodified.

**Event Schema:**

| Component | Type | Description |
|-----------|------|-------------|
| **Topic[0]** | Symbol | Literal: `"executed"` |
| **Topic[1]** | Address | Subscriber Stellar account (G-address) |
| **Topic[2]** | Address | Merchant Stellar account (G-address) |
| **Data** | i128 | Payment amount in token's smallest unit |

**Example (RPC response):**

```json
{
  "type": "contract",
  "ledger": 1_234_890,
  "ledger_close_time": "2025-07-24T10:30:00Z",
  "contract_id": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "id": "0000005314649600-0000000001",
  "topics": [
    "AAAADwAAAAhleGVjdXRlZA==",
    "AAAAAQB6Mcc...",
    "AAAAAQB9RwE..."
  ],
  "data": "AAAACgAAAAoAAAAAAYchIE",
  "in_successful_contract_invocation": true,
  "tx_hash": "2b3c4d5e6f7g8h9i..."
}
```

---

### Event Type 3: Cancellation (Implicit)

**When detected:** When no `subscribe` or `executed` events appear for a `(subscriber, merchant)` pair for an extended period **and** the subscription's `next_payment` has not advanced.

**Semantics:**
- The smart contract does **not** emit a `cancel` event (per design).
- Cancellation is inferred by:
  1. Absence of `executed` events after a period longer than the subscription interval.
  2. (Optional) Querying the contract's persistent storage directly via `getLedgerEntry` (expensive, not recommended for continuous indexing).

**Why this design:**
- Reduces event bloat on the ledger.
- Makes cancellation detection an **indexer concern**, not an on-chain concern.
- Allows indexers to implement their own TTL logic (e.g., mark inactive after 2× subscription interval).

---

## Event Schema

### Decoding Events from Soroban RPC

Events returned by `getEvents()` RPC call use XDR-encoded topics and data. Use the Stellar SDK to decode:

**TypeScript Example:**

```typescript
import { scValToNative, StrKey } from '@stellar/stellar-sdk';
import { base64 } from '@stellar/stellar-sdk/lib/encoding';

interface DecodedEvent {
  eventType: 'subscribe' | 'executed' | 'unknown';
  subscriber: string;
  merchant: string;
  amount: bigint;
  ledger: number;
  ledgerCloseTime: string;
  txHash: string;
}

export function decodeContractEvent(rpcEvent: any): DecodedEvent | null {
  if (rpcEvent.type !== 'contract') {
    return null;
  }

  try {
    const topics = rpcEvent.topics.map((t: string) => 
      scValToNative(xdr.SCVal.fromXDR(base64.decode(t)))
    );
    const data = scValToNative(xdr.SCVal.fromXDR(base64.decode(rpcEvent.data)));

    const eventType = topics[0]; // "subscribe" or "executed"
    const subscriber = StrKey.encodeAccount(
      Buffer.from(topics[1].toString(), 'hex')
    );
    const merchant = StrKey.encodeAccount(
      Buffer.from(topics[2].toString(), 'hex')
    );
    const amount = BigInt(data);

    return {
      eventType: eventType as 'subscribe' | 'executed',
      subscriber,
      merchant,
      amount,
      ledger: rpcEvent.ledger,
      ledgerCloseTime: rpcEvent.ledger_close_time,
      txHash: rpcEvent.tx_hash,
    };
  } catch (error) {
    console.error('Failed to decode event:', error);
    return null;
  }
}
```

---

## Storage Architecture

### Option 1: PostgreSQL (Recommended for SaaS/Enterprise)

**Pros:**
- ACID transactions ensure consistency during concurrent indexing.
- Query flexibility for complex subscription analytics.
- Mature ecosystem and operational tooling.
- TTL management via application logic or database jobs.

**Schema Example:**

```sql
-- Core subscription state
CREATE TABLE subscriptions (
  id BIGSERIAL PRIMARY KEY,
  subscriber_address VARCHAR(56) NOT NULL, -- G-address
  merchant_address VARCHAR(56) NOT NULL,   -- G-address
  token_contract_id VARCHAR(56) NOT NULL,  -- C-address
  amount NUMERIC NOT NULL,                 -- exact token amount
  interval_seconds INT NOT NULL,           -- e.g., 86400 (1 day)
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'cancelled', 'failed'
  cancelled_at TIMESTAMP,
  UNIQUE (subscriber_address, merchant_address),
  INDEX (merchant_address, status), -- for payment collection queries
  INDEX (subscriber_address)        -- for subscriber dashboards
);

-- Payment history
CREATE TABLE payments (
  id BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES subscriptions(id),
  amount NUMERIC NOT NULL,
  executed_at TIMESTAMP NOT NULL,
  ledger_sequence INT NOT NULL,
  transaction_hash VARCHAR(64) NOT NULL UNIQUE,
  INDEX (subscription_id, executed_at DESC), -- payment history
  INDEX (merchant_address, executed_at DESC) -- revenue reports
);

-- Ledger tracking (for resumable polling)
CREATE TABLE indexer_state (
  id INT PRIMARY KEY DEFAULT 1,
  last_ledger_processed INT NOT NULL DEFAULT 0,
  last_cursor VARCHAR(255),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Initialization Flow:**

1. Query Soroban RPC for events from ledger 0 (or a known checkpoint).
2. Decode each event and upsert into `subscriptions` table.
3. Record `last_ledger_processed` in `indexer_state`.
4. Resume from `last_ledger_processed` on restart.

**Cancellation Detection:**

```sql
-- Mark subscriptions as cancelled if no executed event in 2× interval
UPDATE subscriptions
SET status = 'cancelled', cancelled_at = NOW()
WHERE status = 'active'
  AND updated_at < NOW() - INTERVAL '1 day' * (interval_seconds / 86400 * 2);
```

---

### Option 2: MongoDB (Flexible Schema)

**Pros:**
- Flexible schema for evolving event data.
- Document-oriented storage aligns with event payloads.
- Horizontal scaling via sharding.

**Schema Example:**

```javascript
db.subscriptions.insertOne({
  _id: ObjectId(),
  subscriber: "GAAAA...",
  merchant: "GAAAB...",
  tokenContract: "CAAAA...",
  amount: NumberLong(1000000),
  intervalSeconds: 86400,
  status: "active", // "active", "cancelled", "failed"
  createdAt: new Date(),
  updatedAt: new Date(),
  cancelledAt: null,
  nextPaymentExpected: new Date("2025-07-24T10:30:00Z"),
});

db.payments.insertOne({
  _id: ObjectId(),
  subscriptionId: ObjectId(),
  amount: NumberLong(1000000),
  executedAt: new Date(),
  ledgerSequence: 1_234_890,
  transactionHash: "2b3c4d5e6f7g8h9i...",
});

db.indexerState.insertOne({
  _id: "cursor",
  lastLedger: 1_234_890,
  lastCursor: "...",
  updatedAt: new Date(),
});
```

**Indexing:**

```javascript
db.subscriptions.createIndex({ subscriber: 1 });
db.subscriptions.createIndex({ merchant: 1, status: 1 });
db.payments.createIndex({ subscriptionId: 1, executedAt: -1 });
```

---

### Option 3: Time-Series Database (InfluxDB, TimescaleDB)

**Pros:**
- Optimized for high-frequency payment streams.
- Automatic retention policies.
- Excellent for metrics and analytics (revenue over time).

**Schema (TimescaleDB example):**

```sql
CREATE TABLE payments_timeseries (
  time TIMESTAMP NOT NULL,
  merchant_address VARCHAR(56) NOT NULL,
  subscriber_address VARCHAR(56) NOT NULL,
  amount NUMERIC NOT NULL,
  ledger_sequence INT NOT NULL,
  transaction_hash VARCHAR(64) NOT NULL
);

SELECT create_hypertable('payments_timeseries', 'time');
SELECT add_compression_policy('payments_timeseries', INTERVAL '7 days');
```

**Use case:** Real-time dashboards, revenue analytics, payment velocity monitoring.

---

### Option 4: Event Store (EventStoreDB, Axon)

**Pros:**
- Immutable log of all events.
- Event sourcing pattern native.
- Full audit trail.

**Schema (pseudocode):**

```
EventStore:
  ├── stream: "subscription-subscriber-merchant"
  │   ├── event 1: SubscribeEvent(amount=1000000, interval=86400, timestamp=...)
  │   ├── event 2: ExecutedEvent(amount=1000000, timestamp=..., nextPayment=...)
  │   ├── event 3: ExecutedEvent(amount=1000000, timestamp=..., nextPayment=...)
  │   └── event 4: CancelledEvent(timestamp=...)
  └── stream: "subscription-subscriber2-merchant2"
      └── ...
```

**Pros for SorobanPay:**
- Complete payment history immutable.
- Snapshots for subscription state reduce replay overhead.
- Natural fit for CQRS (Command Query Responsibility Segregation).

---

## Indexing Patterns

### Pattern 1: Pull-Based Polling (Recommended for Most Use Cases)

**Flow:**

1. **Poll Interval:** Query RPC every N seconds (e.g., 5–30 seconds).
2. **Pagination:** Use `cursor` from previous response to resume.
3. **Decode & Persist:** Decode events, write to storage.
4. **Resumability:** Save cursor in indexer state; restart from cursor on failure.

**Implementation (Node.js pseudocode):**

```typescript
import { SorobanRpc } from '@stellar/stellar-sdk';

const server = new SorobanRpc.Server(rpcUrl);
const indexerState = await getIndexerState(); // from DB

while (true) {
  try {
    const response = await server.getEvents({
      startLedger: indexerState.lastLedger,
      cursor: indexerState.lastCursor,
      limit: 100,
      filters: [
        {
          type: 'contract',
          contractIds: [contractId],
          topics: [], // all topics
        },
      ],
    });

    for (const event of response.events) {
      const decoded = decodeContractEvent(event);
      if (decoded) {
        await persistEvent(decoded);
      }
    }

    // Save progress
    indexerState.lastLedger = response.latestLedger;
    indexerState.lastCursor = response.cursor || null;
    await updateIndexerState(indexerState);

    // Sleep before next poll
    await sleep(5_000);
  } catch (error) {
    console.error('Indexing error:', error);
    await sleep(30_000); // longer backoff on error
  }
}
```

**Advantages:**
- Simple to implement.
- Resilient to RPC downtime (cursor enables resumption).
- No infrastructure overhead.

**Disadvantages:**
- Polling lag (N-second delay before indexing).
- RPC rate limits may apply.

---

### Pattern 2: Event Sourcing + CQRS

**Architecture:**

```
┌─────────────────┐
│  Soroban RPC    │
│   Event Stream  │
└────────┬────────┘
         │ (poll)
         ▼
┌─────────────────────────┐
│  Event Sourcing Layer   │
│  (append-only log)      │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Projection Layer       │
│  (read models: SQL,     │
│   cache, etc.)          │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Query Interfaces       │
│  (API, Dashboard)       │
└─────────────────────────┘
```

**When to use:**
- Complex business logic (e.g., failed payments, retries).
- Need full audit trail.
- Multiple projections (subscription summary, payment history, revenue).

**Example:**

```typescript
// Event log (immutable)
interface SubscriptionEvent {
  id: string;
  streamId: string; // "subscription-subscriber-merchant"
  type: 'subscribe' | 'executed' | 'cancelled';
  data: Record<string, any>;
  ledger: number;
  timestamp: Date;
}

// Projection: subscription summary
interface SubscriptionSummary {
  subscriber: string;
  merchant: string;
  status: 'active' | 'cancelled' | 'failed';
  currentAmount: bigint;
  currentInterval: number;
  nextPaymentExpected: Date;
  totalCollected: bigint;
  paymentCount: number;
}

// Apply events to projection
function applyEvent(summary: SubscriptionSummary, event: SubscriptionEvent): SubscriptionSummary {
  if (event.type === 'subscribe') {
    return {
      ...summary,
      status: 'active',
      currentAmount: BigInt(event.data.amount),
      currentInterval: event.data.interval,
      nextPaymentExpected: new Date(event.data.nextPayment * 1000),
    };
  }
  if (event.type === 'executed') {
    return {
      ...summary,
      totalCollected: summary.totalCollected + BigInt(event.data.amount),
      paymentCount: summary.paymentCount + 1,
      nextPaymentExpected: new Date(event.data.nextPayment * 1000),
    };
  }
  if (event.type === 'cancelled') {
    return {
      ...summary,
      status: 'cancelled',
    };
  }
  return summary;
}
```

---

## Example Workflows

### Workflow 1: Tracking Subscription Lifecycle

**Requirement:** Dashboard showing all active subscriptions for a merchant.

**Implementation:**

1. **Index subscribe events:** On each `subscribe` event, insert/update row in `subscriptions` table with `status='active'`.
2. **Update on executed:** On each `executed` event, update `subscriptions.updated_at` and insert row in `payments` table.
3. **Detect cancellation:** Batch job (hourly) marks subscriptions as `status='cancelled'` if `updated_at < NOW() - (2 × interval)` and `status='active'`.
4. **Query:** 

```sql
SELECT * FROM subscriptions
WHERE merchant_address = $1 AND status = 'active'
ORDER BY created_at DESC;
```

---

### Workflow 2: Building Payment History

**Requirement:** Display last 10 payments for a subscription.

**Implementation:**

```sql
SELECT p.amount, p.executed_at, p.ledger_sequence, p.transaction_hash
FROM payments p
WHERE p.subscription_id = (
  SELECT id FROM subscriptions
  WHERE subscriber_address = $1 AND merchant_address = $2
)
ORDER BY p.executed_at DESC
LIMIT 10;
```

---

### Workflow 3: Detecting Failed Payment Attempts

**Requirement:** Alert when a payment is due but no `executed` event appears (e.g., insufficient allowance).

**Implementation:**

1. **Compute expected payment time:** `subscription.next_payment + grace_period` (e.g., +1 hour).
2. **Batch check (every 5 minutes):**

```sql
SELECT s.* FROM subscriptions s
WHERE s.status = 'active'
  AND s.updated_at < NOW() - INTERVAL '1 hour'
  AND (SELECT MAX(executed_at) FROM payments WHERE subscription_id = s.id) < NOW() - INTERVAL '30 minutes';
```

3. **Action:** Send alert to merchant, suggest checking subscriber's token allowance.

---

### Workflow 4: Revenue Analytics

**Requirement:** Total revenue collected by a merchant over time.

**Implementation:**

```sql
SELECT
  DATE_TRUNC('day', p.executed_at) AS day,
  SUM(p.amount) AS total_collected,
  COUNT(DISTINCT p.subscription_id) AS payment_count
FROM payments p
WHERE p.merchant_address = $1
  AND p.executed_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', p.executed_at)
ORDER BY day DESC;
```

---

## Implementation Considerations

### 1. Atomic Upserts

**Problem:** Multiple indexer instances may process the same event concurrently.

**Solution:** Use database-level uniqueness constraints or idempotent operations.

**PostgreSQL:**

```sql
INSERT INTO subscriptions (subscriber_address, merchant_address, amount, interval_seconds, status, created_at, updated_at)
VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())
ON CONFLICT (subscriber_address, merchant_address)
DO UPDATE SET
  amount = $3,
  interval_seconds = $4,
  status = 'active',
  updated_at = NOW();
```

---

### 2. Cursor-Based Pagination

**Why not ledger sequence?** Soroban RPC may skip ledgers with no events. Always use the cursor returned in the previous response.

```typescript
interface IndexerState {
  lastLedger: number;
  lastCursor: string | null; // use this!
  updatedAt: Date;
}
```

---

### 3. Batch Processing

For high-volume scenarios, batch event processing:

```typescript
const batchSize = 100;
const batch = [];

for (const event of response.events) {
  const decoded = decodeContractEvent(event);
  if (decoded) {
    batch.push(decoded);
  }

  if (batch.length >= batchSize) {
    await persistBatch(batch);
    batch.length = 0;
  }
}

// flush remaining
if (batch.length > 0) {
  await persistBatch(batch);
}
```

---

### 4. Error Recovery

Handle transient RPC failures gracefully:

```typescript
async function pollWithRetry(maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await server.getEvents({ /* ... */ });
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      const backoff = Math.pow(2, attempt) * 1000; // exponential backoff
      await sleep(backoff);
    }
  }
}
```

---

### 5. Monitoring & Alerting

Track indexer health:

- **Lag:** `NOW() - indexer_state.updated_at` (should be < 60 seconds)
- **Error rate:** Percentage of failed RPC calls per hour
- **Event throughput:** Events indexed per minute

---

## Error Handling & Resilience

### Scenario 1: RPC Endpoint Down

**Mitigation:**
- Fallback to secondary RPC endpoint.
- Exponential backoff before retry.
- Store cursor; resume from exact position.

**Implementation:**

```typescript
const rpcEndpoints = [
  'https://soroban-testnet.stellar.org',
  'https://secondary.rpc.endpoint',
];

let rpcIndex = 0;

async function getServer() {
  return new SorobanRpc.Server(rpcEndpoints[rpcIndex % rpcEndpoints.length]);
}

async function pollWithFailover() {
  for (let attempt = 0; attempt < rpcEndpoints.length; attempt++) {
    try {
      const server = getServer();
      return await server.getEvents({ /* ... */ });
    } catch (error) {
      rpcIndex = (rpcIndex + 1) % rpcEndpoints.length;
      console.log(`RPC failed, trying endpoint ${rpcIndex}: ${error.message}`);
    }
  }
  throw new Error('All RPC endpoints failed');
}
```

---

### Scenario 2: Database Write Failure

**Mitigation:**
- Retry with exponential backoff.
- If retry exhausted, store raw event to dead-letter queue (DLQ).
- Replay DLQ periodically.

**Implementation:**

```typescript
const dlq = new Set<DecodedEvent>();

async function persistEventWithDLQ(event: DecodedEvent) {
  try {
    await persistEvent(event);
  } catch (error) {
    console.error(`DB write failed for event ${event.txHash}, queueing for retry`, error);
    dlq.add(event);

    // Retry DLQ every minute
    if (dlq.size > 0) {
      setTimeout(async () => {
        for (const dlqEvent of Array.from(dlq)) {
          try {
            await persistEvent(dlqEvent);
            dlq.delete(dlqEvent);
          } catch (error) {
            console.error(`DLQ retry failed for ${dlqEvent.txHash}`, error);
          }
        }
      }, 60_000);
    }
  }
}
```

---

### Scenario 3: Ledger Rollback (Rare)

**Context:** Stellar ledgers are finalized after 1000 ledgers (~83 minutes). Events older than that are immutable.

**Mitigation:**
- For real-time indexing, only mark events as "finalized" after 1000-ledger confirmation.
- If a rollback occurs (highly unlikely), re-index from the rollback point.

**Implementation:**

```typescript
const FINALIZATION_LEDGERS = 1000;

async function indexEvent(event: DecodedEvent) {
  const currentLedger = await server.getLatestLedger();
  const isFinalized = (currentLedger.sequence - event.ledger) >= FINALIZATION_LEDGERS;

  await persistEvent({
    ...event,
    isFinalized,
  });

  // Only publish to downstream systems if finalized
  if (isFinalized) {
    await publishEvent(event); // e.g., to message queue
  }
}
```

---

## Deployment Checklist

- [ ] **RPC Endpoint:** Configure primary and fallback endpoints.
- [ ] **Database:** Set up schema, indexes, and retention policies.
- [ ] **Indexer State:** Initialize `indexer_state` table with `last_ledger=0`.
- [ ] **Monitoring:** Set up alerting for indexer lag and error rates.
- [ ] **Testing:** Test resume from cursor after simulated crash.
- [ ] **Backfill:** Run initial sync from ledger 0 (or known checkpoint).
- [ ] **Documentation:** Document custom event projections and query patterns.

---

## References

- [Soroban RPC Event Streaming](https://developers.stellar.org/docs/learn/soroban-rpc/events)
- [Stellar JavaScript SDK](https://developers.stellar.org/docs/learn/stellar-sdk)
- [Event Sourcing Pattern](https://martinfowler.com/eaaDev/EventSourcing.html)
- [CQRS Pattern](https://martinfowler.com/bliki/CQRS.html)
