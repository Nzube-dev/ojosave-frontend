# Backend Test Plan — SorobanPay

**Purpose:** Document all integration tests, mocks, and verification strategies for backend services. Enables rapid feedback on service correctness without external dependencies.

---

## Overview

The backend test suite consists of three layers:

1. **Wallet authentication** — signing and verification with mocked Freighter
2. **Contract interaction** — reconciliation, event replay, and state management
3. **API responses** — HTTP routes and data aggregation

All tests run in-process. No live RPC, database, or Freighter extension required.

---

## Layer 1: Wallet Authentication

**Module:** `tests/helpers/mockFreighterWallet.ts`  
**Test file:** `tests/walletAuth.integration.test.ts`

### What is tested

| Feature | Scenarios | Pass criteria |
|---------|-----------|---------------|
| Account generation | Random keypair creation | Unique public keys |
| Account import | Import from secret key | Public key matches |
| Account connection | Connect to registered account | `getConnectedKey()` returns connected key |
| Error handling | Invalid secret key, unknown account | Throw/return error as expected |
| Transaction signing | Sign with connected account, verify XDR format | Signed XDR is valid and differs from unsigned |
| Error on no connection | Attempt to sign when disconnected | Return error with clear message |
| Invalid XDR | Attempt to sign malformed XDR | Return error (no exception thrown) |
| Signature verification | Verify transaction signed by expected party | `verifyTransaction` returns `{ valid: true, signer: '...' }` |
| Verification failure | Wrong signer or unsigned transaction | `{ valid: false, error: '...' }` |

### Test fixtures

**Deterministic keypairs** (pre-generated, seed-based):
- Alice: `GABC1234...` with secret `SBAA...`
- Bob: `GXYZ5678...` with secret `SBBB...`
- Merchant: `GMER9999...` with secret `SBMM...`

**Pre-built transactions**:
- `TX_ALICE_TO_BOB` — Alice sends 100 XLM to Bob (signed)
- `TX_BOB_TO_MERCHANT` — Bob sends 50 XLM to Merchant (signed)
- `UNSIGNED_TX_ALICE` — Unsigned Alice-to-Bob payment

**Error cases**:
- `INVALID_XDR` — Non-base64 string
- `MALFORMED_XDR` — Valid base64, invalid envelope

### Usage in tests

```typescript
import { MockFreighterWallet } from '../helpers/mockFreighterWallet';
import { ALICE, SECRET_ALICE, TX_ALICE_TO_BOB, NETWORK_TESTNET } from '../helpers/walletFixtures';

const wallet = new MockFreighterWallet();
wallet.importAccount(SECRET_ALICE);
wallet.connect(ALICE);

// Sign a transaction
const { success, xdr, error } = wallet.signTransaction(txUnsigned, NETWORK_TESTNET);

// Verify it
const { valid, signer } = wallet.verifyTransaction(txSigned, ALICE, NETWORK_TESTNET);
```

---

## Layer 2: Contract Interaction

**Module:** `tests/helpers/inMemoryDb.ts`, `reconciler.ts`  
**Test file:** `tests/contractCalls.integration.test.ts`

### What is tested

| Feature | Scenarios | Pass criteria |
|---------|-----------|---------------|
| Subscribe event | New subscription, update on re-subscribe | Record inserted/updated with correct amount and interval |
| Execute payment | Payment due, advance next_payment | Timestamps advance; last_payment_at set |
| Execute without subscribe | No preceding subscribe event | Error reported; no DB mutation |
| Cancel subscription | Remove active subscription | Record deleted |
| Orphan detection | DB record without chain history | Error flagged during reconciliation |

### In-memory database

`InMemorySubscriptionDB` — Map-based implementation of `SubscriptionDB` interface (from `reconciler.ts`).

Methods:
- `get(subscriber, merchant)` — fetch or undefined
- `upsert(record)` — insert or update
- `delete(subscriber, merchant)` — remove
- `all()` — fetch all records
- `clear()` — wipe for test cleanup
- `size()` — count for assertions

### Usage in tests

```typescript
import { reconcile } from '../../reconciler';
import { InMemorySubscriptionDB } from '../helpers/inMemoryDb';

const db = new InMemorySubscriptionDB();
const events = [
  { type: 'subscribe', subscriber: 'GSUB', merchant: 'GMER', amount: 100n, timestamp: T0 },
  { type: 'executed', subscriber: 'GSUB', merchant: 'GMER', amount: 100n, timestamp: T0 + 86400 },
];

const { repairs, errors } = reconcile(events, db, 86400);
expect(repairs).toHaveLength(1);
expect(repairs[0].kind).toBe('insert');
```

---

## Layer 3: Event Indexing & API

**Modules:** `PayoutSummaryGenerator`, express router  
**Test files:** `tests/eventIndexer.integration.test.ts`, `tests/apiResponse.integration.test.ts`

### In-memory Prisma client

`InMemoryPrismaClient` — Prisma-compatible mock with `event` and `payoutSummary` namespaces.

Injected via Jest mock:
```typescript
jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: new (require('../helpers/inMemoryDb').InMemoryPrismaClient)(),
}));
```

Methods:
- `event.findMany({ where })` — query events
- `event.create({ data })` — insert event
- `payoutSummary.findMany()` — list summaries
- `payoutSummary.create({ data })` — create summary
- `payoutSummary.update({ where, data })` — update summary
- `seedEvents([...])` — populate test data
- `reset()` — clear all tables

### Event indexer tests

| Feature | Scenarios | Pass criteria |
|---------|-----------|---------------|
| Daily summary | Events in same day | Total amount and payment count correct |
| Per-token split | Multiple tokens from merchant | Separate summary per token |
| Idempotent | Re-run on same period | Existing summary updated, not duplicated |
| Weekly summary | Events in same week | `type: "weekly"` set correctly |
| No-op | No executed events | No summaries created |

### API tests

| Endpoint | Case | Expected |
|----------|------|---------|
| `GET /merchant/:addr` | No data | `200 []` |
| `GET /merchant/:addr` | With data | `200 [...]` filtered to merchant |
| `GET /merchant/:addr?type=weekly` | Type filter | Only `type: "weekly"` returned |
| `GET /:id` | Known ID | `200 { id, ... }` |
| `GET /:id` | Unknown ID | `404` |

### Usage in tests

```typescript
// Seed test data
db.seedEvents([
  { type: 'executed', subscriber: 'GSUB', merchant: 'GMER', token: 'CTOKEN', amount: '1000', ledgerTimestamp: 1n },
]);

// Generate summaries
await generator.generateDailySummaries(today);

// Assert
const summaries = await db.payoutSummary.findMany({ where: { merchant: 'GMER' } });
expect(summaries[0].totalAmount).toBe('1000');
```

---

## Running tests

```bash
cd backend

# Integration tests only
npm run test:integration

# Unit tests only
npm run test

# All tests
npm run test:all

# Watch mode
npm run test:watch
```

---

## CI/CD

The `backend-integration` job in `.github/workflows/ci.yml` runs on every push:

```yaml
backend-integration:
  name: Backend integration tests
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    - run: npm ci
      working-directory: backend
    - run: npm run test:integration
      working-directory: backend
```

---

## Adding new tests

1. **Fixtures first:** Add deterministic test data to `helpers/walletFixtures.ts` or `inMemoryDb.ts`.
2. **Name conventionally:** Use `*.integration.test.ts` suffix.
3. **Mock external calls:** Inject mocked Prisma or use `InMemoryPrismaClient`.
4. **Seed and reset:** Call `beforeEach()` to reset state between tests.
5. **Assert verifiable behavior:** Check return values, DB state, and error messages — never assume.

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `Jest timeout` | Mock server didn't start | Check `MockRpcServer.start()` is awaited in `beforeAll` |
| `Cannot find module` | Import path wrong or file missing | Verify `jest.config.ts` `moduleNameMapper` and file path |
| `Tests pass locally, fail in CI` | Different Node version | Ensure CI uses Node ≥ 18 |
| `DB state leaks between tests` | Missing `beforeEach` reset | Call `db.reset()` or `wallet.reset()` before each test |
