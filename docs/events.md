# SorobanPay — Contract Event Reference

The `SubscriptionProtocol` contract emits four structured events that off-chain consumers can use for indexing, analytics, and notifications.

Cancellation is intentionally not emitted by the contract. Backend services that need a durable cancellation history should persist confirmed `cancel(subscriber, merchant)` transactions in the off-chain audit trail described in [backend/audit-trail/README.md](../backend/audit-trail/README.md).

---

## Event schemas

### `subscribe`

Emitted when `subscribe()` is called (new subscription or update).

| Field | Type | Value |
|-------|------|-------|
| topic[0] | `Symbol` | `"subscribe"` |
| topic[1] | `Address` | subscriber address |
| topic[2] | `Address` | merchant address |
| topic[3] | `Address` | token contract address |
| data | `i128` | subscription amount (in token stroops) |

### `executed`

Emitted when `execute_payment()` successfully transfers tokens and advances `next_payment`.

| Field | Type | Value |
|-------|------|-------|
| topic[0] | `Symbol` | `"executed"` |
| topic[1] | `Address` | subscriber address |
| topic[2] | `Address` | merchant address |
| topic[3] | `Address` | token contract address |
| data | `i128` | amount transferred (in token stroops) |

### `payment_transfer_failure`

Emitted when `execute_payment()` is called but the subscriber has insufficient balance. The subscription state is **not** modified — the call can be retried once funds are available.

| Field | Type | Value |
|-------|------|-------|
| topic[0] | `Symbol` | `"payment_transfer_failure"` |
| topic[1] | `Address` | subscriber address |
| topic[2] | `Address` | merchant address |
| data | `i128` | amount that was attempted (in token stroops) |

Note: if the transfer fails due to a revoked allowance (rather than insufficient balance), the token contract panics and the entire transaction reverts — no event is emitted in that case.

### `cancel`

Emitted when `cancel()` successfully removes the subscription.

| Field | Type | Value |
|-------|------|-------|
| topic[0] | `Symbol` | `"cancel"` |
| topic[1] | `Address` | subscriber address |
| topic[2] | `Address` | merchant address |
| data | `()` | empty (unit type) |

---

## Fetching events via Stellar RPC

Use `getEvents` on the Soroban RPC to stream contract events:

```bash
curl -s https://soroban-testnet.stellar.org \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getEvents",
    "params": {
      "startLedger": 1000000,
      "filters": [
        {
          "type": "contract",
          "contractIds": ["<YOUR_CONTRACT_ID>"],
          "topics": [["*"]]
        }
      ],
      "pagination": { "limit": 100 }
    }
  }'
```

---

## Decoding events in JavaScript / TypeScript

Install the Stellar SDK:

```bash
npm install @stellar/stellar-sdk
```

### Decode a single event

```typescript
import { xdr, scValToNative } from "@stellar/stellar-sdk";

interface SubscribeEvent {
  type: "subscribe";
  subscriber: string;
  merchant: string;
  token: string;
  amount: bigint;
}

interface ExecutedEvent {
  type: "executed";
  subscriber: string;
  merchant: string;
  token: string;
  amount: bigint;
}

interface PaymentTransferFailureEvent {
  type: "payment_transfer_failure";
  subscriber: string;
  merchant: string;
  amount: bigint;
}

interface CancelEvent {
  type: "cancel";
  subscriber: string;
  merchant: string;
}

type ContractEvent =
  | SubscribeEvent
  | ExecutedEvent
  | PaymentTransferFailureEvent
  | CancelEvent;

function decodeEvent(rawEvent: {
  topic: string[];   // base64-encoded XDR ScVal[]
  value: string;     // base64-encoded XDR ScVal (data)
}): ContractEvent | null {
  const topics = rawEvent.topic.map((t) =>
    scValToNative(xdr.ScVal.fromXDR(t, "base64"))
  );
  const data = scValToNative(xdr.ScVal.fromXDR(rawEvent.value, "base64"));

  const [eventType] = topics as string[];

  if (eventType === "subscribe" || eventType === "executed") {
    const [, subscriber, merchant, token] = topics as string[];
    return { type: eventType, subscriber, merchant, token, amount: BigInt(data) };
  }
  if (eventType === "payment_transfer_failure") {
    const [, subscriber, merchant] = topics as string[];
    return { type: eventType, subscriber, merchant, amount: BigInt(data) };
  }
  if (eventType === "cancel") {
    const [, subscriber, merchant] = topics as string[];
    return { type: eventType, subscriber, merchant };
  }
  return null;
}
```

### Fetch and decode all events for a contract

```typescript
import { SorobanRpc } from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

async function getContractEvents(contractId: string, startLedger: number) {
  const response = await server.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [contractId],
      },
    ],
  });

  return response.events.map((e) =>
    decodeEvent({
      topic: e.topic.map((t) => t.toXDR("base64")),
      value: e.value.toXDR("base64"),
    })
  );
}

// Usage
const events = await getContractEvents(process.env.CONTRACT_ID!, 1000000);
events.forEach((e) => {
  if (!e) return;
  if (e.type === "subscribe") {
    console.log(`New subscription: ${e.subscriber} → ${e.merchant}, amount: ${e.amount}`);
  } else if (e.type === "executed") {
    console.log(`Payment executed: ${e.subscriber} → ${e.merchant}, amount: ${e.amount}`);
  } else if (e.type === "payment_transfer_failure") {
    console.log(`Payment failed (retry eligible): ${e.subscriber} → ${e.merchant}, attempted: ${e.amount}`);
  } else if (e.type === "cancel") {
    console.log(`Subscription cancelled: ${e.subscriber} → ${e.merchant}`);
  }
});
```

---

## Decoding events in Python

Install the `stellar-sdk`:

```bash
pip install stellar-sdk
```

```python
from stellar_sdk import xdr as stellar_xdr
from stellar_sdk.soroban.soroban_rpc import SorobanServer

server = SorobanServer("https://soroban-testnet.stellar.org")

def decode_event(topic_xdrs: list[str], value_xdr: str) -> dict | None:
    topics = [
        stellar_xdr.SCVal.from_xdr(t).sym.sc_symbol.decode()
        if stellar_xdr.SCVal.from_xdr(t).type == stellar_xdr.SCValType.SCV_SYMBOL
        else stellar_xdr.SCVal.from_xdr(t).address
        for t in topic_xdrs
    ]
    # topics = ["subscribe"|"executed", subscriber_addr, merchant_addr]
    event_type = str(topics[0])
    if event_type not in ("subscribe", "executed"):
        return None

    amount_val = stellar_xdr.SCVal.from_xdr(value_xdr)
    amount = int.from_bytes(amount_val.i128.hi.int64.to_bytes(8, "big") +
                            amount_val.i128.lo.uint64.to_bytes(8, "big"), "big", signed=True)
    return {"type": event_type, "subscriber": str(topics[1]),
            "merchant": str(topics[2]), "amount": amount}
```

---

## Amount units

All `amount` values are in **stroops** (the smallest token unit). Divide by `10_000_000` (1e7) to get the human-readable token amount, unless the token uses a different decimal precision.

```typescript
const displayAmount = Number(event.amount) / 1e7;
```
