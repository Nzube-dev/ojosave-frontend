# Smart Contract Version Metadata

## Overview

Version metadata has been added to the SorobanPay subscription contract to enable off-chain systems to verify deployed contract variants and ensure compatibility before integration.

## Implementation Details

### Version Constants (`storage.rs`)

The contract defines four version-related constants:

```rust
pub const CONTRACT_VERSION: &str = "1.0.0";
pub const VERSION_MAJOR: u32 = 1;
pub const VERSION_MINOR: u32 = 0;
pub const VERSION_PATCH: u32 = 0;
pub const CONTRACT_NAME: &str = "SorobanPay-SubscriptionProtocol";
```

These constants use **semantic versioning** (MAJOR.MINOR.PATCH):
- **MAJOR**: Increment for breaking changes (incompatible API changes)
- **MINOR**: Increment for new backwards-compatible features
- **PATCH**: Increment for bug fixes

### Query Entry Points (`lib.rs`)

Two new public entry points allow off-chain systems to query version information:

#### 1. `version()` → Symbol
Returns the contract version as a Symbol for efficient transmission.

**Usage (Off-Chain):**
```typescript
const version = await contract.version();
console.log(`Contract version: ${version}`);

// Compatibility check
if (!version.startsWith("1.")) {
  throw new Error(`Unsupported contract version: ${version}`);
}
```

#### 2. `contract_name()` → Symbol
Returns the contract identifier ("SorobanPay-SubscriptionProtocol").

**Usage (Off-Chain):**
```typescript
const name = await contract.contract_name();
if (name !== "SorobanPay") {
  throw new Error("Not a valid SorobanPay contract");
}
```

### Deployment Event (`events.rs`)

A new event `contract_deployed` signals contract availability to off-chain indexers:

```rust
pub fn emit_contract_deployed(env: &Env, version: &str)
```

**Event Schema:**
- **Topic[0]:** Symbol `"contract_deployed"`
- **Data:** Version symbol (e.g., `"1.0.0"`)

This event can be used by backend indexers to:
- Log contract deployment with version information
- Alert downstream services of contract updates
- Maintain a historical record of deployed versions

## Off-Chain Integration Pattern

### Recommended Bootstrap Workflow

```typescript
async function verifyContractCompatibility(contractId: string) {
  const contract = new Contract(contractId);
  
  // 1. Check contract identity
  const name = await contract.contract_name();
  if (name !== "SorobanPay") {
    throw new Error("Not a SorobanPay contract");
  }
  
  // 2. Check version compatibility
  const version = await contract.version();
  const [major] = version.split(".").map(Number);
  
  if (major !== 1) {
    throw new Error(`Incompatible version: ${version}. Expected v1.x.x`);
  }
  
  console.log(`✓ Contract verified: ${name} v${version}`);
  return true;
}
```

### Backend Event Indexing

When indexing contract events, check for the `contract_deployed` event to track deployed versions:

```typescript
if (event.topics[0] === "contract_deployed") {
  const version = event.data;
  console.log(`Contract deployed: v${version}`);
  
  // Store in database for monitoring
  await db.deployments.insert({
    contractId,
    version,
    deployedAt: new Date(),
  });
}
```

## Version Upgrade Strategy

When upgrading the contract to a new version:

1. **Update constants in `storage.rs`:**
   ```rust
   pub const CONTRACT_VERSION: &str = "1.1.0";
   pub const VERSION_MINOR: u32 = 1;
   ```

2. **Redeploy to a new contract address** (Soroban contracts are immutable)

3. **Off-chain systems should:**
   - Query both old and new contract versions
   - Gradually migrate subscribers to the new contract
   - Maintain compatibility with the old contract during transition

## Design Rationale

### Why Return Symbols?

- **Efficiency:** Symbols are compact on-chain representations
- **Consistency:** Matches Soroban's event system conventions
- **Low cost:** Minimal gas overhead for version queries

### Why No Storage Keys for Metadata?

Contract metadata should not consume persistent storage:
- Version is fixed at compile-time and never changes for a deployed instance
- Persistent storage has TTL requirements (unnecessary overhead)
- Constants are cheaper and deterministic

### Why a Separate Deploy Event?

The `contract_deployed` event enables:
- Historical version tracking without querying each contract
- Early notification to off-chain systems of new deployments
- Automatic indexing of version changes via event subscriptions

## Compatibility Guarantees

Within **v1.x.x**:
- All entry points (`subscribe`, `execute_payment`, `cancel`, `execute_payment_batch`) remain backwards compatible
- Event schemas remain stable (new events may be added, existing topics unchanged)
- Error codes remain stable (never reassigned)
- Storage structure remains compatible (migration not required)

Breaking changes will increment to **v2.0.0**:
- Requires migration script for subscribers
- New contract deployment
- Off-chain systems must support both versions during transition

---

**Last Updated:** June 2026  
**Contract Version:** 1.0.0
