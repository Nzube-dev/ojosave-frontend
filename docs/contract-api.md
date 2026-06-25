# Contract API Reference

Full reference for the three `SubscriptionProtocol` entry points with concrete parameter values and expected outcomes.

---

## `subscribe`

Creates or updates a recurring payment authorization from a subscriber to a merchant.

**Auth:** subscriber must sign.

### Parameters

| Parameter | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `subscriber` | `Address` | — | Wallet authorizing the subscription |
| `merchant` | `Address` | — | Recipient of recurring payments |
| `token` | `Address` | SEP-41 | Token contract address |
| `amount` | `i128` | > 0 | Units per payment interval |
| `interval` | `u64` | 86400–31536000 s | Seconds between payments |

### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source alice \
  --network testnet \
  -- subscribe \
  --subscriber GABC1234...SUBSCRIBER \
  --merchant  GXYZ5678...MERCHANT \
  --token     CABC1111...TOKEN \
  --amount    100 \
  --interval  2592000
```

### TypeScript example

```typescript
import { Contract, nativeToScVal, Address } from "@stellar/stellar-sdk";

const contract = new Contract(contractId);

const op = contract.call(
  "subscribe",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
  new Address(tokenAddress).toScVal(),
  nativeToScVal(100n, { type: "i128" }),      // amount
  nativeToScVal(2592000n, { type: "u64" }),   // interval: 30 days
);
```

### Expected outcome

- Subscription stored in persistent ledger under key `(subscriber, merchant)`.
- `subscribe` event emitted: topics `[Symbol("subscribe"), subscriber, merchant]`, data `amount: 100`.
- `next_payment` set to `current_ledger_time` (first payment collectable immediately).
- Calling `subscribe` again for the same pair **updates** amount/interval and resets TTL.

---

## `execute_payment`

Collects the next due payment. Transfers `amount` tokens directly from subscriber to merchant.

**Auth:** merchant must sign.

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | Subscriber whose payment is due |
| `merchant` | `Address` | Caller — receives the payment |

### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source merchant-key \
  --network testnet \
  -- execute_payment \
  --subscriber GABC1234...SUBSCRIBER \
  --merchant   GXYZ5678...MERCHANT
```

### TypeScript example

```typescript
const op = contract.call(
  "execute_payment",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
);
```

### Expected outcome

- `amount` tokens transferred `subscriber → merchant` via SEP-41 `transfer_from`.
- `next_payment` advanced by `interval` seconds.
- Subscription TTL reset to 365 days.
- `executed` event emitted: topics `[Symbol("executed"), subscriber, merchant]`, data `amount: 100`.

### Error cases

| Error | Code | Trigger |
|-------|------|---------|
| `NoActiveSubscription` | 4 | No subscription found for this pair |
| `PaymentNotDue` | 5 | `now < next_payment` |
| `Unauthorized` | 6 | Caller is not the merchant |

---

## `cancel`

Removes the subscription from persistent storage. No further payments can be collected.

**Auth:** subscriber must sign.

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | Owner of the subscription |
| `merchant` | `Address` | The counterparty |

### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source alice \
  --network testnet \
  -- cancel \
  --subscriber GABC1234...SUBSCRIBER \
  --merchant   GXYZ5678...MERCHANT
```

### TypeScript example

```typescript
const op = contract.call(
  "cancel",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
);
```

### Expected outcome

- Subscription entry deleted from persistent storage.
- No cancellation event is emitted. Off-chain indexers detect cancellation by the absence of `executed` events after `2 × interval`.
- Any future `execute_payment` call returns `NoActiveSubscription` (error 4).

---

## End-to-end flow example

```bash
# 1. Subscribe: alice subscribes to pay merchant 100 USDC every 30 days
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- subscribe \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT \
  --token      CABC...USDC \
  --amount     100 \
  --interval   2592000

# 2. Collect payment (merchant calls this on/after the due date)
stellar contract invoke --id $CONTRACT_ID --source merchant-key --network testnet \
  -- execute_payment \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT

# 3. Cancel (subscriber terminates the agreement)
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- cancel \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT
```

See [events.md](events.md) for the full event schema and decoding examples.
