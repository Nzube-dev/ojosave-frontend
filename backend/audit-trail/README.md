# Subscription Cancellation Audit Trail

This backend design records subscription cancellation events in an off-chain audit trail. The smart contract intentionally does not emit a cancellation event, so the backend records cancellations at the service boundary after a cancellation transaction is confirmed on-chain.

## Goals

- Persist every successful cancellation with a server-side timestamp.
- Store enough subscription metadata for merchants to understand which subscription ended.
- Allow subscribers or merchant-facing tools to attach optional reason text.
- Make duplicate writes safe when clients retry after timeouts.
- Keep the contract as the source of truth for active subscription state.

## Data Model

The primary table is `subscription_cancellations`.

| Column | Purpose |
| --- | --- |
| `id` | Server-generated audit event ID. |
| `network` | Stellar network where cancellation was confirmed, for example `testnet` or `mainnet`. |
| `contract_id` | SorobanPay subscription contract address. |
| `subscriber_address` | Subscriber account that authorized cancellation. |
| `merchant_address` | Merchant account for the cancelled subscription. |
| `token_address` | Token contract used by the subscription at the time cancellation was requested. |
| `amount` | Subscription payment amount in token stroops. |
| `interval_seconds` | Payment interval in seconds. |
| `next_payment_at` | Last known next payment timestamp before cancellation, if available. |
| `cancelled_at` | Backend timestamp when the cancellation was persisted. |
| `ledger` | Ledger sequence from the confirmed cancellation transaction. |
| `transaction_hash` | Stellar transaction hash that executed `cancel`. |
| `reason` | Optional subscriber-provided or operator-provided cancellation reason. |
| `created_at` / `updated_at` | Backend row bookkeeping timestamps. |

The `(network, transaction_hash)` pair is unique. This makes the write idempotent when a client retries a request after losing the HTTP response.

## API

### Create Cancellation Audit Entry

`POST /api/subscriptions/cancellations`

This endpoint is called only after the backend has submitted or observed a successful `cancel(subscriber, merchant)` transaction.

```json
{
  "network": "testnet",
  "contractId": "C...",
  "subscriberAddress": "G...",
  "merchantAddress": "G...",
  "tokenAddress": "C...",
  "amount": "10000000",
  "intervalSeconds": 2592000,
  "nextPaymentAt": "2026-07-24T12:00:00Z",
  "ledger": 1234567,
  "transactionHash": "abc123...",
  "reason": "Switching to annual billing"
}
```

Validation:

- `network`, `contractId`, `subscriberAddress`, `merchantAddress`, `ledger`, and `transactionHash` are required.
- `amount` is stored as text to avoid precision loss across JavaScript runtimes and SQL drivers.
- `reason` is optional, trimmed, and limited to 1,000 characters.
- `tokenAddress`, `amount`, `intervalSeconds`, and `nextPaymentAt` should be supplied from the last known subscription snapshot when available.

Response:

```json
{
  "id": "018f7b52-6fb6-7d8d-a4f2-1c011f6fc0c1",
  "cancelledAt": "2026-06-24T12:30:00Z"
}
```

### List Merchant Cancellations

`GET /api/merchants/{merchantAddress}/cancellations?network=testnet&limit=50&cursor=...`

Returns newest cancellations first for a merchant dashboard.

```json
{
  "items": [
    {
      "id": "018f7b52-6fb6-7d8d-a4f2-1c011f6fc0c1",
      "network": "testnet",
      "contractId": "C...",
      "subscriberAddress": "G...",
      "merchantAddress": "G...",
      "tokenAddress": "C...",
      "amount": "10000000",
      "intervalSeconds": 2592000,
      "nextPaymentAt": "2026-07-24T12:00:00Z",
      "cancelledAt": "2026-06-24T12:30:00Z",
      "ledger": 1234567,
      "transactionHash": "abc123...",
      "reason": "Switching to annual billing"
    }
  ],
  "nextCursor": null
}
```

## Write Flow

1. Load the active subscription snapshot before invoking `cancel`, including token, amount, interval, and next payment timestamp.
2. Submit the cancellation transaction and wait for confirmation from Stellar RPC.
3. Verify the transaction succeeded and invoked the expected `cancel(subscriber, merchant)` function on the configured contract.
4. Insert a row into `subscription_cancellations` with the snapshot, transaction hash, ledger, backend timestamp, and optional reason.
5. If the insert conflicts on `transaction_hash`, return the existing audit entry instead of creating a duplicate.

## Reconciliation

Because the contract emits no cancellation event, indexers cannot reconstruct cancellations from the event stream alone. A production backend should periodically reconcile active subscriptions against contract state:

- If an active subscription disappears and no audit row exists, create a row with `reason = null` and `source = "reconciliation"` if the backend schema is extended with source tracking.
- Keep this reconciliation path separate from user-provided cancellation reasons so merchant dashboards can distinguish explicit reasons from inferred cancellations.

## Privacy and Retention

Reason text can contain customer-provided content. Treat it as merchant-visible private data:

- Limit reason text length.
- Do not include reason text in logs.
- Apply the same retention policy as billing history.
- Prefer soft deletion or access redaction over physical deletion if audit integrity is required.
