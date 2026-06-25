# Version Metadata Quick Reference

## Contract Entry Points

### Query the Contract Version

```typescript
// Using Stellar SDK
const version = await contract.version();
console.log(version); // "1.0.0"
```

### Query the Contract Name

```typescript
// Using Stellar SDK
const name = await contract.contract_name();
console.log(name); // "SorobanPay"
```

## Version Constants (Rust)

Located in `contracts/subscription/src/storage.rs`:

```rust
pub const CONTRACT_VERSION: &str = "1.0.0";      // Full semver string
pub const VERSION_MAJOR: u32 = 1;                 // Breaking changes
pub const VERSION_MINOR: u32 = 0;                 // New features
pub const VERSION_PATCH: u32 = 0;                 // Bug fixes
pub const CONTRACT_NAME: &str = "SorobanPay-SubscriptionProtocol";
```

## Version Semantics

- **MAJOR.MINOR.PATCH**
  - **MAJOR:** Increment for breaking changes (incompatible API)
  - **MINOR:** Increment for new backwards-compatible features
  - **PATCH:** Increment for bug fixes only

## Recommended Off-Chain Verification

```typescript
// 1. Verify contract identity
const name = await contract.contract_name();
if (name !== "SorobanPay") {
  throw new Error("Not a valid SorobanPay contract");
}

// 2. Check version compatibility
const version = await contract.version();
const [major, minor, patch] = version.split(".").map(Number);

if (major !== 1) {
  throw new Error(`Incompatible major version: ${major}`);
}

// 3. Log for monitoring
console.log(`✓ Contract verified: ${name} v${version}`);
```

## Updating the Version

When releasing a new version:

1. **In `storage.rs`:**
   ```rust
   pub const CONTRACT_VERSION: &str = "1.1.0";  // Update here
   pub const VERSION_MAJOR: u32 = 1;
   pub const VERSION_MINOR: u32 = 1;            // and here
   pub const VERSION_PATCH: u32 = 0;
   ```

2. **In `lib.rs`:**
   ```rust
   pub fn version(env: Env) -> Symbol {
       symbol_short!("1.1.0")  // Update here too
   }
   ```

3. **In `Cargo.toml`:**
   ```toml
   [package]
   version = "1.1.0"  # And here
   ```

4. **Rebuild and redeploy** to new contract address

## Event Integration

The `contract_deployed` event can be used to track deployments:

```typescript
// Monitor for deployment events
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

## Testing Version Queries

```rust
#[test]
fn test_version() {
    let t = T::new();
    let version = t.client.version();
    // Version is available and queryable
}

#[test]
fn test_contract_name() {
    let t = T::new();
    let name = t.client.contract_name();
    // Name is available for identification
}
```

## Compatibility Guarantees

✅ **v1.0.0 → v1.x.x:** Fully backwards compatible  
❌ **v1.x.x → v2.0.0:** Requires contract migration

## Common Patterns

### Pattern 1: Bootstrap Verification
```typescript
async function connectToContract(contractId) {
  const version = await contract.version();
  const name = await contract.contract_name();
  
  // Verify and proceed
  if (name !== "SorobanPay" || !version.startsWith("1.")) {
    throw new Error("Incompatible contract");
  }
  
  return { version, name };
}
```

### Pattern 2: Version Range Checking
```typescript
async function isVersionCompatible(contractId, minVersion, maxVersion) {
  const version = await contract.version();
  const [major, minor] = version.split(".").map(Number);
  
  return major >= minVersion.major && major <= maxVersion.major;
}
```

### Pattern 3: Health Check
```typescript
async function healthCheck(contractId) {
  try {
    const version = await contract.version();
    return { healthy: true, version };
  } catch (e) {
    return { healthy: false, error: e.message };
  }
}
```

## Frequently Asked Questions

**Q: Can I call version() frequently?**  
A: Yes, it's a read-only operation with minimal gas cost.

**Q: Does calling version() affect contract state?**  
A: No, these are pure query operations with no side effects.

**Q: What happens when I upgrade to v2.0.0?**  
A: Deploy to a new contract address. Off-chain systems can query both old and new versions during migration.

**Q: Can I use this for permission checking?**  
A: No, version is public information. Use authorization patterns for access control.

**Q: How often should I check the version?**  
A: Once at startup, plus periodically during health checks. Off-chain indexers can monitor via deployment events.

---

**Last Updated:** June 2026  
**Current Version:** 1.0.0  
**Compatibility:** v1.x.x stable
