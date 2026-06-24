# Edge Case: Repeated Cancel Calls After Subscription Removal

## Overview

This document describes the comprehensive test suite added to validate deterministic behavior when `cancel()` is called multiple times on a subscription that has already been removed. This edge case is critical for off-chain systems that may retry cancellation due to network latency, race conditions, or transient failures.

**Key Guarantee:** After the first successful `cancel()` call, all subsequent `cancel()` attempts on the same subscription **must consistently return `NoActiveSubscription`**.

---

## Why This Matters

### Problem Statement

Off-chain backend systems managing subscriptions may experience:

1. **Network Latency:** A cancel request succeeds on-chain but the response is lost before reaching the client.
2. **Retry Logic:** The client automatically retries the operation, sending a second cancel request.
3. **Uncertain State:** Without a clear, deterministic error, the system cannot distinguish between:
   - "The subscription was cancelled" (idempotent cancel)
   - "The subscription still exists but something else went wrong" (transient failure)

### Impact

If repeated cancel calls are not handled consistently:

- **Silent Failures:** Off-chain systems may incorrectly mark a subscription as active.
- **Data Corruption:** Inconsistent state across databases and on-chain records.
- **Reconciliation Failures:** Backend systems cannot reliably detect and report subscription status.

### Solution

The contract implements **idempotent cancellation semantics**: once removed, repeated cancels return `NoActiveSubscription` deterministically. This allows off-chain systems to:

1. Retry cancel operations safely without side effects.
2. Distinguish between a cancelled subscription and transient failures.
3. Build reliable reconciliation logic.

---

## Test Suite

### Test 1: `test_repeated_cancel_after_removal_consistent`

**What it tests:**
- First cancel succeeds and removes the subscription.
- Second cancel returns `NoActiveSubscription`.
- Subscription remains permanently removed.

**Implementation:**
```rust
#[test]
fn test_repeated_cancel_after_removal_consistent() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    // Create subscription
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    assert!(t.has_sub(), "subscription must be created");

    // First cancel removes subscription
    let result1 = t.client.try_cancel(&t.subscriber, &t.merchant);
    assert!(result1.is_ok(), "first cancel must succeed");
    assert!(!t.has_sub(), "subscription must be removed");

    // Second cancel returns NoActiveSubscription
    let result2 = t.client.try_cancel(&t.subscriber, &t.merchant);
    assert!(
        matches!(result2, Err(Ok(ContractError::NoActiveSubscription))),
        "second cancel must return NoActiveSubscription"
    );

    // Subscription remains absent
    assert!(!t.has_sub(), "subscription must remain removed");
}
```

**Why:** Validates the core idempotent cancel contract at the smallest scale.

---

### Test 2: `load_test_repeated_cancel_multiple_attempts`

**What it tests:**
- One subscription cancellation followed by N-1 retry attempts (N=5).
- All retries consistently return `NoActiveSubscription`.
- Subscription never re-appears.

**Implementation:**
```rust
#[test]
fn load_test_repeated_cancel_multiple_attempts() {
    const N: usize = 5;

    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);

    // First cancel succeeds
    let first_result = t.client.try_cancel(&t.subscriber, &t.merchant);
    assert!(first_result.is_ok(), "first cancel must succeed");

    // All subsequent cancels return NoActiveSubscription
    for attempt in 2..=N {
        let result = t.client.try_cancel(&t.subscriber, &t.merchant);
        assert!(
            matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
            "cancel attempt #{} must return NoActiveSubscription",
            attempt
        );
    }

    // Subscription remains permanently removed
    assert!(!t.has_sub(), "subscription must be permanently removed");
}
```

**Why:** Stress-tests idempotency under repeated retries, simulating realistic backend retry behavior.

---

### Test 3: `test_cancel_then_execute_payment_consistent_error`

**What it tests:**
- After cancellation, `execute_payment()` also returns `NoActiveSubscription` (no state confusion).
- Time advancement doesn't accidentally re-activate a cancelled subscription.
- No tokens are transferred.

**Implementation:**
```rust
#[test]
fn test_cancel_then_execute_payment_consistent_error() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    // Create and cancel
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    t.client.cancel(&t.subscriber, &t.merchant);

    // Advance time past the original next_payment window
    t.advance(ivl + 1);

    // execute_payment also returns NoActiveSubscription
    let result = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
        "execute_payment after cancel must return NoActiveSubscription"
    );

    // Verify no tokens were transferred
    assert_eq!(t.sub_bal(), 10_000_000_i128, "subscriber balance must be unchanged");
    assert_eq!(t.mer_bal(), 0_i128, "merchant must not receive funds");
}
```

**Why:** Ensures cancellation prevents **all** operations on the subscription, not just cancellation itself. This guards against bugs where cancellation state is tracked incorrectly.

---

### Test 4: `test_repeated_cancel_multi_pair_no_cross_contamination`

**What it tests:**
- Multiple subscriber-merchant pairs maintain independent state.
- Cancelling one pair doesn't affect others.
- Repeated cancels on one pair return consistent errors.

**Implementation:**
```rust
#[test]
fn test_repeated_cancel_multi_pair_no_cross_contamination() {
    // ... setup: create four subscriptions across all (sub, mer) combinations

    // Cancel (sub1, mer1) twice
    assert!(client.try_cancel(&sub1, &mer1).is_ok(), "first cancel must succeed");
    assert!(
        matches!(client.try_cancel(&sub1, &mer1), Err(Ok(ContractError::NoActiveSubscription))),
        "second cancel must return NoActiveSubscription"
    );

    // Verify only (sub1, mer1) was removed; others remain intact
    assert!(!has_subscription(&sub1, &mer1), "(sub1, mer1) removed");
    assert!(has_subscription(&sub1, &mer2), "(sub1, mer2) still exists");
    assert!(has_subscription(&sub2, &mer1), "(sub2, mer1) still exists");
    assert!(has_subscription(&sub2, &mer2), "(sub2, mer2) still exists");

    // ... repeat for another pair
}
```

**Why:** Validates that storage keys are handled correctly and that removal of one subscription doesn't corrupt others. Catches potential bugs in key collision or state indexing.

---

### Test 5: `test_repeated_cancel_no_extra_events`

**What it tests:**
- First cancel emits exactly one `cancel` event.
- Subsequent cancel attempts emit **no events**.
- The event stream remains clean and predictable.

**Implementation:**
```rust
#[test]
fn test_repeated_cancel_no_extra_events() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let events_after_subscribe = t.env.events().all().len();

    // First cancel emits 1 event
    t.client.cancel(&t.subscriber, &t.merchant);
    let events_after_first_cancel = t.env.events().all().len();
    assert_eq!(events_after_first_cancel, events_after_subscribe + 1, "first cancel emits 1 event");

    // Repeated cancels emit no additional events
    for attempt in 1..=5 {
        let result = t.client.try_cancel(&t.subscriber, &t.merchant);
        assert!(
            matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
            "cancel attempt #{} must fail",
            attempt
        );
    }

    let final_event_count = t.env.events().all().len();
    assert_eq!(final_event_count, events_after_first_cancel, "no extra events on repeated failures");
}
```

**Why:** Ensures off-chain event indexers receive a clean, predictable stream. Failed cancels that emit spurious events can corrupt backend reconciliation logic.

---

### Test 6: `prop_repeated_cancel_is_deterministic` (Property-Based)

**What it tests:**
- For **any** valid subscription (using property-based testing with random amounts and intervals), repeated cancels are deterministic.
- First cancel always succeeds.
- All subsequent cancels always return `NoActiveSubscription`.
- Subscription is always permanently removed.

**Implementation:**
```rust
#[test]
fn prop_repeated_cancel_is_deterministic() {
    proptest!(|(amount in 1_i128..=100_000_i128,
                interval in 86_400_u64..=31_536_000_u64)| {
        let t = T::new();

        // Create subscription
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);

        // First cancel must succeed
        let result1 = t.client.try_cancel(&t.subscriber, &t.merchant);
        prop_assert!(result1.is_ok(), "first cancel must succeed");

        // All subsequent cancels must consistently fail with NoActiveSubscription
        for _ in 0..5 {
            let result = t.client.try_cancel(&t.subscriber, &t.merchant);
            prop_assert!(
                matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
                "repeated cancel must always return NoActiveSubscription"
            );
        }

        // Subscription must remain permanently absent
        prop_assert!(!t.has_sub(), "subscription must be permanently removed");
        prop_ok!(())
    });
}
```

**Why:** Uses property-based testing (via `proptest`) to validate the edge case holds across the entire input space, not just a few hardcoded examples. This catches corner cases that deterministic tests might miss.

---

## Expected Behavior Summary

| Operation | First Cancel | Second Cancel | Third Cancel | ... |
|-----------|--------------|---------------|--------------|-----|
| Result | **Ok(())** | **Err(NoActiveSubscription)** | **Err(NoActiveSubscription)** | ... |
| Subscription State | Removed | Removed | Removed | ... |
| Events Emitted | 1 `cancel` event | 0 events | 0 events | ... |
| Token Balances | Unchanged | Unchanged | Unchanged | ... |

---

## Integration with Off-Chain Systems

### Scenario: Backend Retry Logic

```pseudocode
// Off-chain backend service
async function ensureSubscriptionCancelled(subscriber, merchant) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await contract.cancel(subscriber, merchant);
            console.log(`Cancel succeeded on attempt ${attempt}`);
            return { success: true, attempt };
        } catch (error) {
            if (error.code === "NoActiveSubscription") {
                // Subscription already removed — idempotent cancel working as intended
                console.log(`Subscription already cancelled (detected on attempt ${attempt})`);
                return { success: true, alreadyCancelled: true, attempt };
            }
            if (attempt === maxRetries) {
                throw error; // Transient failure after max retries
            }
            // Transient failure (e.g., network timeout) — retry
            await sleep(exponentialBackoff(attempt));
        }
    }
}
```

### Scenario: Reconciliation Job

```sql
-- Off-chain reconciliation: detect subscriptions that should be marked as cancelled
SELECT s.id, s.subscriber, s.merchant
FROM subscriptions s
WHERE s.status = 'active'
  AND (
    -- No executed event in 2× interval AND attempted cancels returned NoActiveSubscription
    (SELECT MAX(executed_at) FROM payments WHERE subscription_id = s.id)
      < NOW() - INTERVAL '1 day' * (s.interval_seconds / 86400 * 2)
    OR
    -- Subscription was explicitly cancelled (detected by cancel event or NoActiveSubscription error)
    s.cancelled_at IS NOT NULL
  );
```

---

## Contract Guarantees

1. **Atomicity:** Cancel removes the subscription in a single atomic operation.
2. **Idempotence:** Cancel is safe to retry; second+ attempts fail cleanly with `NoActiveSubscription`.
3. **Determinism:** Repeated cancels always produce the same error code.
4. **No Side Effects:** Failed cancel attempts don't mutate state or emit events.
5. **Isolation:** Cancelling one (subscriber, merchant) pair doesn't affect others.

---

## Maintenance Notes

### When to Update These Tests

- **If cancel logic is modified:** Ensure repeated cancels still return `NoActiveSubscription` consistently.
- **If storage key scheme changes:** Re-run multi-pair test to verify isolation.
- **If event emission logic changes:** Verify no spurious events are emitted on failures.
- **If new error codes are added:** Ensure they don't break idempotent cancel semantics.

### Related Tests

- `test_execute_after_cancel` — Validates that execute_payment also fails after cancel.
- `prop_cancel_prevents_future_payments` — Property-based test ensuring cancel prevents future execution.
- `test_cancel_and_resubscribe` — Validates that re-subscription after cancel works correctly.

---

## References

- **Contract Code:** `contracts/subscription/src/lib.rs` — `cancel()` implementation
- **Test Code:** `contracts/subscription/src/test.rs` — Edge case test suite
- **Error Definitions:** `contracts/subscription/src/error.rs` — `NoActiveSubscription` error code
- **Architecture:** `docs/architecture.md` — Backend integration patterns
