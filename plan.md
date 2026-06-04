# SorobanPay — Wave Program Contribution Plan

## Project Overview

SorobanPay is a non-custodial recurring payments protocol built on Stellar's Soroban smart contract platform. It enables subscription billing, creator monetization, and recurring donations directly on-chain — without custodial wallets or complex pre-authorized transaction arrays.

The protocol consists of a Rust/Soroban smart contract, a Next.js 14 frontend with Freighter wallet integration, and automated build/deployment tooling.

---

## Types of Work I Would Post as Issues

### 1. Bug Fixes

The most immediate category. Real-world usage will surface edge cases that automated tests don't catch.

**Example issues:**
- `[bug] execute_payment reverts when subscriber revokes allowance mid-interval` — investigate error propagation path and improve error messaging to callers
- `[bug] Freighter connection state not cleared on browser extension uninstall` — wallet manager needs a periodic liveness check
- `[bug] Subscription form interval field accepts decimals — should reject non-integers` — validation regex needs tightening
- `[bug] Transaction confirmation polling continues after component unmount` — memory leak, needs AbortController

---

### 2. New Features

Protocol extensions that expand the subscription model.

**Example issues:**
- `[feature] Add get_subscription view function` — read-only entry point returning SubscriptionData for a given (subscriber, merchant) pair, enabling frontends to display active subscription details without indexing events
- `[feature] Multi-token support UI` — allow users to select from a pre-approved token list rather than manually entering a C-address
- `[feature] Cancel subscription from frontend` — wire up the contract's cancel() entry point in the UI with confirmation dialog
- `[feature] Payment history page` — query Soroban RPC event stream for executed events and display transaction history per subscriber

---

### 3. Documentation

Developer-facing docs that lower the barrier to integration.

**Example issues:**
- `[docs] Add contract integration guide` — step-by-step for external dApps calling subscribe/execute_payment via stellar-sdk
- `[docs] Document event schema for off-chain indexers` — full specification of subscribe and executed event topics and data types
- `[docs] Add troubleshooting section to README` — common errors (insufficient allowance, expired TTL, auth failures) and how to resolve them
- `[docs] Deployment guide for mainnet` — checklist covering identity setup, funding, and STELLAR_NETWORK=mainnet usage

---

### 4. Testing

Expanding coverage beyond the current unit and property-based test suite.

**Example issues:**
- `[test] Add integration test for TTL expiry scenario` — simulate 365+ days passing and verify storage entry becomes inaccessible
- `[test] Add fuzz tests for execute_payment with adversarial token contracts` — mock token that panics or returns unexpected errors
- `[test] Frontend: add Jest tests for validateSubscriptionForm edge cases` — boundary values at exactly 86400 and 31536000 seconds
- `[test] Add end-to-end test on Stellar testnet` — scripted flow using stellar-sdk: deploy → subscribe → execute_payment → cancel

---

### 5. Performance & Security

Production hardening tasks.

**Example issues:**
- `[security] Audit token.transfer authorization flow` — verify require_auth semantics match SEP-41 spec for contract-initiated transfers
- `[perf] Optimize WASM binary size` — profile opt-level="z" output and evaluate wasm-opt post-processing
- `[security] Add rate-limiting guidance for execute_payment callers` — document that merchants should implement off-chain scheduling to avoid redundant RPC calls

---

## Sprint Structure

Each sprint cycle I would scope issues to be completable in 1–3 days by a single contributor:

- **Small** (half day): documentation updates, single test case additions, minor UI fixes
- **Medium** (1–2 days): new view functions, frontend feature additions, bug fixes with test coverage
- **Large** (2–3 days): new contract entry points, end-to-end tests, security audits

All issues would include clear acceptance criteria, relevant file pointers, and links to the requirements or design documents in `.kiro/specs/soroban-pay/`.
