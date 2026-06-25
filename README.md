# SorobanPay — Decentralized Subscription & Recurring Payments Protocol

A production-grade, non-custodial recurring payments protocol built on Stellar's Soroban smart contract platform. Enables SaaS billing, creator subscriptions, and recurring donations directly on-chain — no custodial wallets, no pre-authorized transaction arrays.

---

## Architecture

```
SorobanPay
├── contracts/subscription/   Rust/Soroban smart contract
├── deploy/deploy.sh          Automated testnet/mainnet deployment
├── frontend/                 Next.js 14 TypeScript frontend
├── backend/audit-trail/      Backend cancellation audit trail design
└── Makefile                  Build, test, and clean targets
```

**Three layers:**
1. **Smart Contract** — `SubscriptionProtocol` Soroban contract with `subscribe`, `execute_payment`, and `cancel` entry points. Uses persistent storage with TTL management and emits structured events for off-chain indexing. This is the sole source of truth for subscription state and payment execution — it never holds balances and requires a fresh auth signature on every call.
2. **Frontend** — Next.js 14 App Router + Freighter wallet integration + Tailwind CSS. Signs and submits transactions directly to Soroban RPC; handles no server-side logic.
3. **Backend** (`backend/`) — Optional off-chain service for event indexing, cancellation detection, payout summaries, and a merchant REST API. Read-only with respect to the chain — it polls `getEvents()` but never submits transactions. See [docs/architecture.md](docs/architecture.md) for the full backend role definition.
4. **Build & Deploy** — GNU Makefile + bash deployment script with testnet/mainnet switching.

### System flow

```
+------------------+        +---------------------+        +----------------+
|   Subscriber     |        |       Merchant      |        | Optional       |
|  (Freighter)     |<------>|   (Service Owner)   |<------>| Backend/Indexer|
+--------+---------+  Web   +----------+-----------+  API   +--------+-------+
         |                       Web                         |    ^
         |                        |                         |    |
         v                        v                         |    |
+--------+--------+        +--------+--------+               |    |
|   Frontend       |        | Merchant Portal  |---------------+    |
|  (Next.js + TS)  |        | or Admin Panel    |                      |
+--------+--------+        +-------------------+                      |
         |                                                                 |
         | contract ops                                                    |
         v                                                                 |
+--------+--------+                                                       |
| Soroban Contract |------------------------------------------------------+
| subscribe()       |
| execute_payment() |
| cancel()          |
+--------+--------+
         |
         v
+--------+--------+
| Soroban Ledger   |
| + PersistentStore |
| + SEP-41 Token    |
+------------------+
```

**Flow summary:**
1. **Subscriber** signs transactions via Freighter in the Next.js frontend.
2. **Frontend** dispatches contract calls (`subscribe`, `cancel`, `execute_payment`) through the Stellar RPC.
3. **Soroban Contract** executes on-chain, interacting with the **SEP-41 Token** for allowances/transfers and persisting state in the **Soroban Ledger**.
4. **Structured events** emitted by the contract can be indexed by an **optional backend** for analytics, history, or notification triggers.
5. **Cancellation audit records** are persisted off-chain by backend services after confirmed `cancel` transactions because the contract does not emit cancellation events.
6. **Merchant** may use a dedicated portal or admin panel to trigger `execute_payment` and view subscription state.

---

## Quick Start (testnet demo — ~5 minutes)

Get SorobanPay running on Stellar testnet from a clean machine.

### 1. Install prerequisites

```bash
# Rust + wasm target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Stellar CLI
cargo install --locked stellar-cli --features opt

# Node.js ≥ 18  →  https://nodejs.org (or use nvm)
```

### 2. Clone and build

```bash
git clone https://github.com/Chrisland58/SorobanPay.git
cd SorobanPay
make build
```

### 3. Deploy to testnet

```bash
stellar keys generate alice --network testnet
stellar keys fund alice --network testnet
CONTRACT_ID=$(bash deploy/deploy.sh)
echo "Contract: $CONTRACT_ID"
```

### 4. Configure and start the frontend

```bash
cd frontend
cp .env.example .env.local
# Edit .env.local — paste $CONTRACT_ID into NEXT_PUBLIC_CONTRACT_ID
npm install
npm run dev
```

Open http://localhost:3000 in a browser with the [Freighter extension](https://www.freighter.app) installed and set to **Testnet**.

### 5. Try a subscription

1. In Freighter, switch to Testnet and fund your wallet via [Friendbot](https://laboratory.stellar.org/#account-creator?network=test).
2. Open the app, enter a merchant address and amount, and click **Subscribe**.
3. Approve the transaction in Freighter — the subscription is now live on-chain.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | stable | https://rustup.rs |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | ≥ 21.x | https://developers.stellar.org/docs/tools/stellar-cli |
| Node.js | ≥ 18.x | https://nodejs.org |
| Freighter browser extension | latest | https://www.freighter.app |

---

## Smart Contract

### Build

```bash
make build
```

Compiles the Rust contract to `contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm` using the `--release` profile (`opt-level = "z"`, `lto = true`).

**Override defaults at the command line:**

```bash
make build TARGET_TRIPLE=<triple> PROFILE=<debug|release>
```

Example — cross-compile for a different WASM target:

```bash
make build TARGET_TRIPLE=wasm32-unknown-unknown PROFILE=release
```

### Extending the Makefile for new targets

The Makefile exposes two override-friendly variables:

- `TARGET_TRIPLE` — Rust compilation target (default: `wasm32-unknown-unknown`)
- `PROFILE` — Cargo profile name (default: `release`)

**To add a new compilation target:**

1. Install the Rust target with `rustup target add <triple>`.
2. Build with `make build TARGET_TRIPLE=<triple>`.
3. The output artifact lands under `contracts/target/<triple>/<profile>/soroban_subscription_contract.wasm`.

Example — add a native host build target:

```bash
make build TARGET_TRIPLE=x86_64-unknown-linux-gnu PROFILE=debug
```

**Caution:** `make test` always runs via the native host (`cargo test` without `--target`). Do not set `TARGET_TRIPLE` for testing; WASM cross-targets cannot execute tests.

### Test

```bash
make test
```

Equivalent to:

```bash
cargo test \
  --manifest-path contracts/subscription/Cargo.toml
```

**Prerequisites:**
- Rust stable toolchain
- `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`)

Runs the full test suite: unit tests (lifecycle, error paths, auth, events) and property-based tests (time-lock, double-payment prevention, balance invariant, and more).

### Clean

```bash
make clean
```

Removes all build artifacts from `contracts/target/`.

---

## Deployment

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STELLAR_NETWORK` | `testnet` | Target network: `testnet` or `mainnet` |
| `STELLAR_IDENTITY` | `alice` | Stellar CLI identity alias to sign and pay fees |

### Deploy to testnet

```bash
# 1. Create identity (one-time)
stellar keys generate alice --network testnet

# 2. Fund via Friendbot (testnet only — free)
stellar keys fund alice --network testnet

# 3. Deploy
bash deploy/deploy.sh
```

The contract address is printed to stdout. All diagnostic output goes to stderr. Save the address — you will need it for the frontend `.env.local`.

### Deploy to mainnet

Mainnet requires a **real funded account**. There is no Friendbot.

```bash
# 1. Generate a mainnet identity (one-time)
stellar keys generate my-mainnet-id --network mainnet

# 2. Print the public key and fund it with real XLM (minimum ~2 XLM for base reserve + fee)
stellar keys address my-mainnet-id

# 3. Deploy
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh
```

On success the contract address is printed to stdout, e.g.:

```
CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Capture it directly if needed:

```bash
CONTRACT_ID=$(STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh)
echo "Deployed: $CONTRACT_ID"
```

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `ERROR: Contract build failed` | Rust toolchain or `wasm32` target missing | Run `rustup target add wasm32-unknown-unknown` |
| `ERROR: WASM artifact not found` | Build produced no output | Check `make build` output; ensure `opt-level = "z"` is set in `Cargo.toml` |
| `ERROR: Contract deployment failed` | Identity not funded or CLI not configured | Fund the account; verify with `stellar keys address <identity>` |
| `ERROR: Unknown STELLAR_NETWORK value` | Typo in `STELLAR_NETWORK` | Allowed values are exactly `testnet` or `mainnet` |
| Empty contract ID returned | RPC node unreachable or rate-limited | Retry; check RPC URL connectivity |
| Transaction fee too low (mainnet) | Surge pricing during congestion | Re-run; the script uses the Stellar CLI default fee which self-adjusts |

---

## Frontend

### 1. Install Freighter

Freighter is the Stellar browser wallet the app uses for signing transactions.

1. Install the extension for [Chrome / Brave](https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk) or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/freighter/).
2. Open Freighter and create or import a wallet.
3. Click the network selector in the top-right and choose **Testnet** (for local development) or **Mainnet** (for production).
4. Fund your testnet wallet via [Stellar Friendbot](https://laboratory.stellar.org/#account-creator?network=test).

> **Mainnet note:** Freighter defaults to Mainnet. Make sure the network in Freighter matches `NEXT_PUBLIC_NETWORK_PASSPHRASE` in your `.env.local`, or transactions will be rejected.

### 2. Configure environment variables

Copy the example env file:

```bash
cp frontend/.env.example frontend/.env.local
```

Edit `frontend/.env.local`:

```env
# Contract address output by deploy.sh
NEXT_PUBLIC_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Testnet
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Mainnet (swap these two lines when deploying to mainnet)
# NEXT_PUBLIC_RPC_URL=https://mainnet.stellar.validationcloud.io/v1/<YOUR_KEY>
# NEXT_PUBLIC_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_CONTRACT_ID` | ✅ | Deployed contract address (`C…`) from `deploy.sh` |
| `NEXT_PUBLIC_RPC_URL` | ✅ | Soroban RPC endpoint |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | ✅ | Must match the network Freighter is set to |

### 3. Install dependencies and run

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. Freighter will prompt for connection on the first interaction.

### Build for production

```bash
cd frontend
npm run build
npm start
```

### Type check

```bash
cd frontend
npm run type-check
```

### Troubleshooting Freighter

#### Connection errors

**Symptom:** "Wallet not connected" badge appears and the Submit button is disabled.

Steps to resolve:
1. Click the Freighter extension icon in your browser toolbar.
2. If the site is not listed under "Connected Sites", click **Connect** and approve the connection prompt.
3. Reload the page — the badge should turn green.

**Symptom:** Freighter popup does not appear when the page loads.

Steps to resolve:
1. Confirm the Freighter extension is installed (Chrome/Brave or Firefox — see [Install Freighter](#1-install-freighter)).
2. Make sure the page is served over `http://localhost` or `https://`. Freighter blocks requests from `file://` origins.
3. Disable other wallet extensions temporarily — they can conflict with the Freighter injected API.
4. Try a hard reload (`Ctrl+Shift+R` / `Cmd+Shift+R`).

#### Signing / permission failures

**Symptom:** Transaction rejected — "User declined" or signing popup dismissed.

Steps to resolve:
1. Open Freighter and confirm the correct account is selected.
2. Re-submit the form; Freighter will show the signing prompt again.
3. If Freighter closes before you can sign, disable browser pop-up blockers for `localhost`.

**Symptom:** Transaction rejected — wrong network.

Steps to resolve:
1. Open Freighter → click the network name at the top-right.
2. Select the network that matches `NEXT_PUBLIC_NETWORK_PASSPHRASE` in your `.env.local`:
   - Testnet passphrase: `Test SDF Network ; September 2015`
   - Mainnet passphrase: `Public Global Stellar Network ; September 2015`
3. Reload and retry.

**Symptom:** "Insufficient balance" error.

Steps to resolve:
- **Testnet:** fund your wallet at [Stellar Friendbot](https://laboratory.stellar.org/#account-creator?network=test).
- **Mainnet:** transfer at least 2 XLM to your account to cover the base reserve and transaction fee.

#### Quick-reference table

| Symptom | Fix |
|---------|-----|
| "Wallet not connected" badge | Open Freighter and approve the site connection |
| Signing popup never appears | Serve the app over `http://localhost` or `https://`; disable conflicting extensions |
| Transaction rejected — wrong network | Match Freighter's network selector to `NEXT_PUBLIC_NETWORK_PASSPHRASE` |
| "Insufficient balance" | Fund via Friendbot (testnet) or send XLM (mainnet) |
| Freighter not detected | Install the extension; page must be on `http://localhost` or `https://` |
| Popup closes before signing | Disable pop-up blockers for `localhost` |

---

## Wallet connection UX states

The `SubscriptionForm` component reflects the wallet and transaction lifecycle through distinct visual states. Contributors should maintain these states when modifying the form.

| State | Trigger | UI indicator | Submit button |
|-------|---------|-------------|---------------|
| **Disconnected** | `publicKey` is `null` (Freighter not connected or not approved) | Gray badge: "Disconnected" with dim dot | Disabled; yellow hint: "Connect your Freighter wallet to enable submission." |
| **Connected / idle** | `publicKey` is set, `isSubmitting` is `false` | Green badge: "Connected" with green dot | Enabled: "Authorize Subscription" |
| **Awaiting signature** | `isSubmitting` is `true` (transaction sent to Freighter, waiting for user approval) | Blue animated spinner + progress bar with label "Submitting transaction…" | Disabled: "Submitting…" with spinner |
| **Success** | `successData` is set after transaction confirmed | Green `SuccessCard` with tx hash, summary, and next-steps guidance | Hidden; replaced by "Create another subscription" button |
| **Error** | `txError` is set after a failed or rejected transaction | Red alert box with error message and "Your form data has been preserved — review and retry." | Re-enabled; form data retained for correction |

### State transition diagram

```
Disconnected ──(connect Freighter)──► Connected/idle
Connected/idle ──(submit form)──► Awaiting signature
Awaiting signature ──(user approves)──► Success
Awaiting signature ──(user rejects / timeout / RPC error)──► Error
Error ──(fix form & resubmit)──► Awaiting signature
Success ──(click "Create another")──► Connected/idle
```

---

## Contract entry points

| Function | Auth required | Description |
|----------|--------------|-------------|
| `subscribe(subscriber, merchant, token, amount, interval)` | subscriber | Create or update subscription. Amount must be > 0, interval in [86400, 31536000] seconds. |
| `execute_payment(subscriber, merchant)` | merchant | Collect payment if interval has elapsed. Transfers tokens directly subscriber → merchant. |
| `cancel(subscriber, merchant)` | subscriber | Remove subscription from persistent storage. |

### Examples

**subscribe** — authorize 100 tokens every 30 days:

```bash
stellar contract invoke \
  --id $CONTRACT_ID --source alice --network testnet \
  -- subscribe \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT \
  --token      CABC...USDC \
  --amount     100 \
  --interval   2592000
```

```typescript
import { Contract, nativeToScVal, Address } from "@stellar/stellar-sdk";
const op = contract.call(
  "subscribe",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
  new Address(tokenAddress).toScVal(),
  nativeToScVal(100n, { type: "i128" }),
  nativeToScVal(2592000n, { type: "u64" }),
);
// Expected: subscription stored, `subscribe` event emitted, first payment collectable immediately.
```

**execute_payment** — merchant collects a due payment:

```bash
stellar contract invoke \
  --id $CONTRACT_ID --source merchant-key --network testnet \
  -- execute_payment \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT
```

```typescript
const op = contract.call(
  "execute_payment",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
);
// Expected: 100 tokens transferred subscriber → merchant, `executed` event emitted, next_payment advanced.
```

**cancel** — subscriber terminates the agreement:

```bash
stellar contract invoke \
  --id $CONTRACT_ID --source alice --network testnet \
  -- cancel \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT
```

```typescript
const op = contract.call(
  "cancel",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
);
// Expected: subscription removed; future execute_payment calls return NoActiveSubscription (error 4).
```

For the full parameter reference and error cases see [docs/contract-api.md](docs/contract-api.md).

### Events emitted

| Event | Topics | Data | Condition |
|-------|--------|------|-----------|
| `subscribe` | `(symbol("subscribe"), subscriber, merchant, token)` | `amount: i128` | Always on success |
| `executed` | `(symbol("executed"), subscriber, merchant, token)` | `amount: i128` | Successful transfer |
| `payment_transfer_failure` | `(symbol("payment_transfer_failure"), subscriber, merchant)` | `amount: i128` | Insufficient balance detected before transfer |
| `cancel` | `(symbol("cancel"), subscriber, merchant)` | `()` | Always on success |

Events use a `Symbol` discriminant as the first topic. The data field is an `i128` amount in stroops (or `()` for `cancel`).

**Quick decode example (TypeScript):**

```typescript
import { xdr, scValToNative } from "@stellar/stellar-sdk";

function decodeEvent(topic: string[], value: string) {
  const [type, subscriber, merchant] = topic.map((t) =>
    scValToNative(xdr.ScVal.fromXDR(t, "base64"))
  );
  const amount = BigInt(scValToNative(xdr.ScVal.fromXDR(value, "base64")));
  return { type, subscriber, merchant, amount };
}
```

See [docs/events.md](docs/events.md) for the full event reference, RPC query examples, and Python decoding code.

---

## Transaction fees and execution budgets

Soroban charges fees based on **CPU instructions**, **memory bytes**, and **ledger entry reads/writes**. All three entry points are computationally O(1) — they touch a fixed number of storage entries and make no loops — but they differ meaningfully in cost because `execute_payment` crosses into an external token contract.

### Cost breakdown per entry point

#### `subscribe` — moderate cost

Operations performed:
- 1 `require_auth` on `subscriber`
- 5 input validations (amount bounds, interval bounds, timestamp guard)
- 1 persistent storage write (`SubscriptionData` struct, ~5 fields)
- 1 TTL extension (`extend_ttl` on the same entry)
- 1 event publish (`subscribe`, 4 topics + i128 data)

This is a pure write with no cross-contract calls. Expect roughly **50,000–150,000 CPU instructions** under normal conditions. The dominant cost is the auth verification and the persistent storage write (ledger entry write fee).

**Budget guidance:**
- Inclusion fee: standard (100 stroops is usually sufficient on testnet; 1,000–10,000 stroops on mainnet during normal congestion)
- Resource fee: set `instructions` to at least **150,000** and `write_bytes` to at least **300**
- The Stellar CLI and SDKs can simulate the transaction first (`simulateTransaction`) to get exact values

#### `execute_payment` — highest cost

Operations performed:
- 1 `require_auth` on `merchant`
- 1 persistent storage read
- 1 ledger timestamp read
- 1 cross-contract `balance` call on the SEP-41 token contract
- 1 cross-contract `transfer` call on the SEP-41 token contract (the most expensive operation)
- 1 persistent storage write (updated `next_payment`)
- 1 TTL extension
- 1 event publish (`executed` or `payment_transfer_failure`, depending on outcome)

The two cross-contract calls — especially `transfer`, which itself performs auth checks, balance reads, and two storage writes inside the token contract — are what make this the most expensive entry point. Soroban charges for every instruction executed within invoked contracts, not just the top-level caller.

**Budget guidance:**
- Resource fee: set `instructions` to at least **500,000** and `write_bytes` to at least **500**
- Always run `simulateTransaction` before broadcasting — the simulation returns exact `instructions`, `readBytes`, and `writeBytes` values
- If the subscriber has insufficient balance, the contract returns `TransferFailed` early (after the `balance` read but before `transfer`) and emits `payment_transfer_failure`. This path is slightly cheaper than a successful transfer since the token's `transfer` is never invoked

#### `cancel` — lowest cost

Operations performed:
- 1 `require_auth` on `subscriber`
- 1 persistent storage `has` check (read)
- 1 persistent storage `remove`
- 1 event publish (`cancel`, 2 topics + unit data)

No cross-contract calls, no writes to new keys. Removing a persistent entry reduces ledger size, which may earn a small rent refund. This is the cheapest of the three entry points.

**Budget guidance:**
- Resource fee: set `instructions` to at least **50,000** and `write_bytes` to at least **100**
- In practice the `simulateTransaction` result will likely be even lower

### Relative cost ranking

```
execute_payment  >  subscribe  >  cancel
(cross-contract       (write +       (read +
 transfer)             TTL extend)    remove)
```

### How to get exact fee estimates

Never hardcode fee values for production. Always simulate:

```bash
# Simulate a subscribe call and inspect the fee breakdown
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  --simulate-only \
  -- subscribe \
  --subscriber <SUBSCRIBER_ADDRESS> \
  --merchant  <MERCHANT_ADDRESS> \
  --token     <TOKEN_ADDRESS> \
  --amount    1000000 \
  --interval  86400
```

Or via the JavaScript SDK:

```typescript
import { SorobanRpc, TransactionBuilder, Networks } from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

// Build the transaction, then simulate before signing
const simResult = await server.simulateTransaction(tx);

if (SorobanRpc.Api.isSimulationSuccess(simResult)) {
  console.log("Min resource fee:", simResult.minResourceFee); // in stroops
  console.log("CPU instructions:", simResult.transactionData.resources().instructions());
  console.log("Write bytes:",      simResult.transactionData.resources().writeBytes());
}
```

The `minResourceFee` from simulation is the floor. Add a 10–25% buffer on `instructions` for safety — network-level variance (e.g., host version upgrades) can shift costs slightly between simulation and submission.

### Ledger entry rent and TTL

`subscribe` and `execute_payment` both call `extend_ttl` to keep the subscription entry alive:

- Minimum TTL: ~30 days (518,400 ledgers at 5 s/ledger)
- Maximum TTL: ~365 days (6,307,200 ledgers)

The TTL extension adds a **rent fee** proportional to the number of ledgers being extended and the size of the entry. For most subscriptions the entry is small (~200 bytes), so rent is a minor fraction of the total fee. If a subscription entry expires (TTL reaches zero) before `cancel` is called, it will be evicted from the ledger; a new `subscribe` call will recreate it.

### Fee behavior on failure

Failed calls that return a `ContractError` (e.g., `PaymentNotDue`, `NoActiveSubscription`, `TransferFailed`) **still consume fees** for the work performed up to the point of the error. The transaction is included in the ledger as a failed invocation. Budget accordingly:

| Scenario | Fee relative to success |
|----------|------------------------|
| `execute_payment` → `PaymentNotDue` | ~10–20% of full cost (only auth + storage read before early return) |
| `execute_payment` → `TransferFailed` | ~60–80% of full cost (balance cross-contract call completed, transfer skipped) |
| `subscribe` → validation error | ~10–15% of full cost (auth + validation only, no write) |
| `cancel` → `NoActiveSubscription` | ~10% of full cost (auth + storage has check only) |

---

## Error codes

| Code | Name | Trigger |
|------|------|---------|
| 1 | `AmountMustBePositive` | `amount ≤ 0` in `subscribe` |
| 2 | `IntervalTooShort` | `interval < 86400` in `subscribe` |
| 3 | `IntervalTooLong` | `interval > 31536000` in `subscribe` |
| 4 | `NoActiveSubscription` | No subscription found for `(subscriber, merchant)` pair |
| 5 | `PaymentNotDue` | `now < next_payment` in `execute_payment` |
| 6 | `Unauthorized` | Authorization check failed |

---

## Event Indexing Architecture

SorobanPay emits structured events via Soroban RPC for off-chain indexing. The contract publishes four event types:

- **`subscribe`** — Emitted when a subscription is created or updated. Signals the start of a recurring payment relationship.
- **`executed`** — Emitted after a successful payment transfer and timestamp advance. Confirms payment collection.
- **`payment_transfer_failure`** — Emitted when a payment attempt fails due to insufficient subscriber balance. The subscription remains active and is eligible for retry.
- **`cancel`** — Emitted after a subscription is successfully removed. Provides an explicit, reliable signal for off-chain indexers to mark the relationship as ended.

### Key Components

| Component | Purpose |
|-----------|---------|
| **Event Sources** | Soroban RPC's `getEvents()` endpoint (topics: event type, subscriber, merchant) |
| **Storage** | PostgreSQL, MongoDB, or time-series DBs for subscription state and payment history |
| **Indexing Pattern** | Pull-based polling with cursor-based pagination; event sourcing + CQRS for complex workflows |
| **Resumability** | Save RPC cursor in `indexer_state` to resume after failures |

### Event Schema

Each event contains:
- **Topics:** `(symbol, subscriber_address, merchant_address[, token_address])` — enables filtering by party or event type
- **Data:** `amount: i128` (or `()` for `cancel`) — payment amount in token's smallest unit

### Recommended Architecture

For most SaaS and merchant dashboard use cases, a **PostgreSQL-backed pull indexer** is recommended. Characteristics:

1. Poll Soroban RPC every 5–30 seconds for new events.
2. Decode and persist to tables: `subscriptions`, `payments`, `indexer_state`.
3. Use `cancel` events to immediately mark subscriptions inactive; use `payment_transfer_failure` events to flag subscriptions for retry logic.
4. Serve queries via REST/GraphQL API for merchant dashboards.

For high-volume payment streams, consider **event sourcing + CQRS** to maintain an immutable event log and multiple projections (subscription summary, revenue analytics, etc.).

### Documentation

For detailed guidance on event sources, storage options, indexing patterns, workflows, and error handling, see [docs/architecture.md](docs/architecture.md).

---

## Security model

- **Non-custodial**: The contract never holds token balances. Transfers go directly `subscriber → merchant` via SEP-41 `transfer`.
- **Per-invocation auth**: Every entry point requires a fresh `require_auth()` signature — no stored sessions.
- **Allowance model**: Subscribers grant a SEP-41 allowance to the contract. Revoking allowance via `token.approve(contract_id, 0)` prevents future payments regardless of on-chain subscription state.
- **Time-lock**: Payment cannot be collected before `next_payment` — enforced on-chain by the Soroban ledger timestamp.
- **TTL**: Subscriptions have a ~30-day minimum and ~365-day maximum TTL. Each successful payment resets the 365-day clock.

For guidance on storing backend secrets safely (database credentials, RPC API keys, webhook secrets), see [docs/security.md](docs/security.md).

---

## Contributing

We welcome contributions! Whether you want to report a bug, suggest an enhancement, or submit code changes, here's how to get started.

### Filing Issues

**Bug Reports** — If you've found a problem:
1. Check existing issues to avoid duplicates
2. Use the **bug** label
3. Provide:
   - Clear description of the issue
   - Steps to reproduce (if applicable)
   - Expected vs. actual behavior
   - Environment details (OS, Node.js version, Rust version)
   - Error messages or logs

**Feature Requests** — To suggest improvements:
1. Use the **enhancement** label
2. Describe the use case and expected behavior
3. Include any relevant examples or references

### Making Changes

**Setting up locally:**

```bash
# Clone the repository
git clone https://github.com/Chrisland58/SorobanPay.git
cd SorobanPay

# Install prerequisites (see Prerequisites section above)

# Build and test
make build
make test

# Frontend setup
cd frontend
npm install
npm run dev
```

**Submitting code:**
1. Create a feature branch: `git checkout -b fix/issue-number` or `git checkout -b feature/description`
2. Write tests for new functionality
3. Ensure all tests pass: `make test` (contract) and `npm run type-check` (frontend)
4. Run linters: `next lint` (frontend)
5. Commit with clear, descriptive messages
6. Push your branch and open a pull request

**PR guidelines:**
- Link the related issue (e.g., "Closes #189")
- Describe what changed and why
- Include any breaking changes
- Ensure CI/CD checks pass

### Labels

| Label | Purpose |
|-------|---------|
| `bug` | Something isn't working |
| `enhancement` | New feature or improvement |
| `documentation` | Updates to docs or comments |
| `test` | Test coverage or test improvements |
| `contract` | Changes to the Soroban smart contract |
| `frontend` | Changes to the Next.js frontend |
| `deployment` | Changes to build or deploy scripts |

---

## License

MIT
