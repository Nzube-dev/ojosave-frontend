# Backend Integration Tests

Automated integration tests for the three backend layers:
contract-call reconciliation, event indexing, and API responses.

No external services are required — all tests run fully in-process.

---

## Structure

```
backend/
├── tests/
│   ├── helpers/
│   │   ├── inMemoryDb.ts       In-memory Prisma-compatible client + SubscriptionDB
│   │   └── mockRpcServer.ts    HTTP mock of the Soroban RPC getEvents endpoint
│   ├── contractCalls.integration.test.ts   Reconciler logic against in-memory DB
│   ├── eventIndexer.integration.test.ts    PayoutSummaryGenerator aggregation
│   └── apiResponse.integration.test.ts     Express router with in-memory DB
├── jest.config.ts
└── package.json
```

---

## Running the tests

```bash
# Integration tests only
cd backend
npm run test:integration

# Unit tests only (reconciler.test.ts)
npm run test

# Everything
npm run test:all
```

---

## Test suites

### contractCalls — `reconciler.ts`

Exercises the `reconcile()` function against `InMemorySubscriptionDB`.

| Case | What is verified |
|------|-----------------|
| subscribe event | Record is inserted with correct `amount` and `next_payment` |
| re-subscribe (amount change) | Existing record is updated |
| executed event | `last_payment_at` and `next_payment` advance by `interval` |
| executed without subscribe | Error reported; no DB mutation |
| cancel event | Record is deleted |
| orphan detection | DB record with no chain history reported as error |

### eventIndexer — `PayoutSummaryGenerator`

Uses `jest.mock` to inject `InMemoryPrismaClient` in place of the real Prisma
client, then seeds `executed` events and asserts the generated summaries.

| Case | What is verified |
|------|-----------------|
| daily summary | Totals across all subscribers for the day |
| per-token split | Separate summary created per token |
| idempotent regeneration | Existing summary is updated, not duplicated |
| no events | No summaries created |
| weekly summary | `type` field is `"weekly"` |

### apiResponse — Express router (`/api/summaries`)

Starts the summaries router on a random port using `http.createServer`.
All DB calls hit `InMemoryPrismaClient`.

| Endpoint | Case | Expected |
|----------|------|---------|
| `GET /merchant/:addr` | No summaries | `200 []` |
| `GET /merchant/:addr` | With data | `200` array filtered to requested merchant |
| `GET /merchant/:addr?type=weekly` | Type filter | Returns only weekly summaries |
| `GET /:id` | Known ID | `200` summary object |
| `GET /:id` | Unknown ID | `404` |

---

## Helpers

### `InMemorySubscriptionDB`

Implements `SubscriptionDB` from `reconciler.ts` using a plain `Map`.
Use `db.seedEvents()` / `db.reset()` in `beforeEach`.

### `InMemoryPrismaClient`

Drop-in replacement for `prisma` with `event` and `payoutSummary` namespaces.
Inject via `jest.mock('../../src/lib/prisma', ...)`.

### `MockRpcServer`

Starts an `http.Server` on a random port and returns configurable
`getEvents` responses. Useful for testing `EventIndexer` end-to-end.

```typescript
const mock = new MockRpcServer();
await mock.start();
mock.setEvents([{ type: 'subscribe', subscriber: '...', ... }]);
// point EventIndexer at mock.baseUrl
await mock.stop();
```

---

## CI

The `backend-integration` job in `.github/workflows/ci.yml` runs
`npm run test:integration` on every push and pull request.
