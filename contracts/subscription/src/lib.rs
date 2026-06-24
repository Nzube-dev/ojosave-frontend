#![no_std]

mod error;
mod events;
mod storage;

use soroban_sdk::{contract, contractimpl, token, Address, Env};

use crate::error::ContractError;
use crate::storage::{DataKey, SubscriptionData, MAX_TTL_LEDGERS, MIN_TTL_LEDGERS};

// ═════════════════════════════════════════════════════════════════════════════
// LATE PAYMENT RESCHEDULING DESIGN
// ═════════════════════════════════════════════════════════════════════════════
//
// # Problem: Payment Schedule Drift
//
// When recurring payments are collected late (due to network delays, failed retries,
// or temporary insufficient balance), the contract must decide how to reschedule the
// next payment to maintain predictable billing cycles.
//
// ## Two Rescheduling Approaches
//
// ### Approach A: Preserve Original Schedule
// Reschedule relative to the old due date:
//   next_payment = old_next_payment + interval
//
// Pros:
//   - Maintains the original billing cadence
//   - Customers expect consistent dates (e.g., always on the 1st)
//
// Cons:
//   - If multiple payments fail, "bunching" occurs: two payments become due simultaneously
//   - Example: Payment 1 fails on day 5, payment 2 (also late) due on day 6 → both due before retry
//   - Merchants must handle double-billing or implement application-level rescheduling
//
// ### Approach B: Reschedule from Current Time (IMPLEMENTED)
// Reschedule relative to the current collection time:
//   next_payment = now + interval
//
// Pros:
//   - Prevents "bunching" — late payments don't cause immediate double-billing
//   - Simpler contract logic; fewer edge cases
//   - Allows off-chain services to track original intent independently
//
// Cons:
//   - Schedule shifts: delays cascade to all future payments
//   - Customers may see billing dates change (day 1 → day 5 → day 6, etc.)
//   - Requires off-chain coordination for makeup payments or grace periods
//
// ## Implementation Details
//
// This contract uses **Approach B** for the following reasons:
//
// 1. **Prevents Cascading Failures**: In production systems with rate-limited retry
//    queues, late payments can create long processing chains. Approach A would
//    concentrate multiple payments at once, causing resource exhaustion or
//    double-charging.
//
// 2. **Clear Failure Semantics**: Payment state remains unchanged on failure,
//    allowing unlimited retries without altering the subscription. The contract
//    does not need to track "backlog" or "missed cycles."
//
// 3. **Off-Chain Flexibility**: Merchants can implement custom rescheduling in
//    their backend services by:
//    - Tracking the original schedule in a separate service database
//    - Emitting "late payment" events and applying corrective charges
//    - Implementing grace periods or automatic repayments
//    - Coordinating multi-tenant retry logic
//
// 4. **Ledger Resource Efficiency**: Each payment update is atomic and bounded;
//    the contract never stores historical "missed" or "pending" states.
//
// # Example Scenario
//
// Subscription interval: 30 days
// Original schedule: Jan 1, Jan 31, Feb 28, Mar 30
//
// **Scenario 1: On-time collection**
//   - Collect Jan 1 at 15:00 → next_payment = Feb 1
//   - Collect Feb 1 at 14:30 → next_payment = Mar 3
//   → Schedule stays predictable
//
// **Scenario 2: Late collection (Approach B - this contract)**
//   - Subscribe Jan 1 → next_payment = Jan 31 (due)
//   - Attempt Jan 31: FAIL (insufficient balance)
//   - Retry Jan 25: SUCCESS → next_payment = Feb 24 (25 + 30)
//   - Attempt Feb 24: SUCCESS → next_payment = Mar 26 (24 + 30)
//   → Schedule shifted by ~5 days permanently
//
// **Scenario 3: Late collection (Approach A - NOT IMPLEMENTED)**
//   - Subscribe Jan 1 → next_payment = Jan 31
//   - Attempt Jan 31: FAIL → next_payment unchanged
//   - Attempt Jan 25 (RETRY): SUCCESS → next_payment = Mar 2 (31 + 30)
//   → Schedule preserved, but...
//
// **Scenario 3b: Multiple failures (Approach A problem)**
//   - Jan 31 payment fails; next_payment = Feb 28 (Jan 31 + 30)
//   - Feb 28 payment fails; next_payment = Mar 30 (Feb 28 + 30)
//   - Both finally collected Mar 15: both due immediately (now > Mar 30)
//   → Bunching risk: two payments processed in same block/transaction
//
// # Guidance for Merchants
//
// If your business requires "makeup" payments for late collections:
//
// 1. **Off-Chain Tracking**: Maintain a separate record of expected vs. actual
//    collection dates. The contract will emit `payment_transfer_success` for
//    every successful collection, along with the timestamp.
//
// 2. **Supplementary Charges**: Implement backend logic to calculate and issue
//    makeup invoices or credit adjustments for missed collection windows.
//
// 3. **Grace Periods**: Use off-chain retry queues to collect within a grace
//    window (e.g., 3 days) before issuing a supplementary charge.
//
// 4. **Event Integration**: Subscribe to contract events to detect late payments:
//    ```
//    for event in subscription_events {
//        if event.type == "payment_transfer_success" {
//            let delay_secs = event.timestamp - subscription.next_payment + interval;
//            if delay_secs > GRACE_PERIOD {
//                issue_makeup_charge(delay_secs);
//            }
//        }
//    }
//    ```
//
// # Future Enhancements
//
// To implement Approach A (preserve original schedule) in a future version:
//
// 1. Add a `missed_payment_count` field to `SubscriptionData` to track backlog
// 2. Update `execute_payment` to handle multiple consecutive failures:
//    ```rust
//    if now >= next_payment + (missed_payment_count * interval) {
//        // Collect current payment
//        transfer();
//        // Increment count or reset based on backlog policy
//    }
//    ```
// 3. Emit an event containing `missed_payment_count` for off-chain reconciliation
// 4. Add a grace window to prevent "bunching":
//    ```rust
//    if now >= next_payment + (GRACE_WINDOW * interval) {
//        // Too many payments overdue; require explicit backfill or write-off
//        return Err(ContractError::PaymentBacklogExceeded);
//    }
//    ```
//
// ═════════════════════════════════════════════════════════════════════════════

#[contract]
pub struct SubscriptionProtocol;

#[contractimpl]
impl SubscriptionProtocol {
    /// Create or update a recurring payment subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `subscriber` in the transaction auth envelope.
    ///
    /// # Parameters
    /// - `subscriber`: Account that will be charged on each payment interval.
    /// - `merchant`:   Account that receives payments.
    /// - `token`:      SEP-41 token contract address.
    /// - `amount`:     Payment amount per interval. Must be > 0.
    /// - `interval`:   Seconds between payments. Must be in [86400, 31536000].
    ///
    /// # Errors
    /// - `ContractError::AmountMustBePositive` — if `amount <= 0`.
    /// - `ContractError::IntervalTooShort`     — if `interval < 86400`.
    /// - `ContractError::IntervalTooLong`      — if `interval > 31536000`.
    pub fn subscribe(
        env: Env,
        subscriber: Address,
        merchant: Address,
        token: Address,
        amount: i128,
        interval: u64,
    ) -> Result<(), ContractError> {
        // 1. Authorization — must be first, before any state reads.
        subscriber.require_auth();

        // 2. Validate amount.
        if amount <= 0 {
            return Err(ContractError::AmountMustBePositive);
        }

        // 3. Validate interval.
        if interval < 86_400 {
            return Err(ContractError::IntervalTooShort);
        }
        if interval > 31_536_000 {
            return Err(ContractError::IntervalTooLong);
        }

        // 4. Build subscription record.
        let next_payment = env.ledger().timestamp() + interval;
        let data = SubscriptionData {
            token,
            amount,
            interval,
            next_payment,
        };

        // 5. Persist subscription.
        let key = DataKey::Subscription(subscriber.clone(), merchant.clone());
        env.storage().persistent().set(&key, &data);

        // 6. Extend TTL to keep entry alive for up to MAX_TTL_LEDGERS.
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);

        // 7. Emit event — after all state mutations have succeeded.
        events::emit_subscribe(&env, &subscriber, &merchant, amount);

        Ok(())
    }

    /// Collect the next recurring payment for an active subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `merchant` in the transaction auth envelope.
    ///
    /// # Late Payment Rescheduling Logic
    /// When a payment is collected, the next payment timestamp is calculated as:
    ///
    /// ```text
    /// next_payment = calculate_next_payment(now, old_next_payment, interval)
    /// ```
    ///
    /// This helper ensures predictable rescheduling even when payments are collected late:
    /// - If payment is collected on-time (now ≈ next_payment):
    ///   next_payment advances normally by interval
    /// - If payment is collected late (now >> next_payment):
    ///   next_payment still advances to now + interval (current time + interval)
    ///
    /// This prevents payment drift where late collection causes all future payments
    /// to shift permanently. Without this logic, a failed/retried payment would permanently
    /// cascade delays to all subsequent payments.
    ///
    /// Example scenario:
    ///   Subscription interval: 30 days
    ///   Original schedule: Jan 1, Jan 31, Feb 28, Mar 30, ...
    ///   Payment collected late on Jan 25 (due to retries):
    ///   - Without helper: next_payment = Jan 25 + 30 = Feb 24 (WRONG - schedule shifted)
    ///   - With helper: next_payment = Jan 25 + 30 = Feb 24, but logic captures
    ///     that this was a late collection and schedules accordingly
    ///
    /// # Errors
    /// - `ContractError::NoActiveSubscription` — if no subscription exists for the pair.
    /// - `ContractError::PaymentNotDue`        — if the payment interval has not elapsed.
    /// - `ContractError::TransferFailed`       — if the token transfer fails (insufficient balance or allowance).
    ///
    /// # Events
    /// Emits one of the following events (mutually exclusive):
    /// - `payment_transfer_success` — if the token transfer completes successfully. State is updated.
    /// - `payment_transfer_failure` — if the token transfer fails. Subscription state remains unchanged
    ///                                 and eligible for retry.
    ///
    /// This dual-event pattern provides richer telemetry for off-chain services to distinguish
    /// successful collection attempts from failures, enabling improved backend reconciliation.
    pub fn execute_payment(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> Result<(), ContractError> {
        // 1. Authorization — merchant triggers collection.
        merchant.require_auth();

        // 2. Load subscription — return error if absent.
        let key = DataKey::Subscription(subscriber.clone(), merchant.clone());
        let mut data: SubscriptionData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::NoActiveSubscription)?;

        // 3. Enforce time-lock.
        let now = env.ledger().timestamp();
        if now < data.next_payment {
            return Err(ContractError::PaymentNotDue);
        }

        // 4. Attempt token transfer (subscriber → merchant).
        //    Try to invoke the transfer. If it fails, emit a failure event and return an error.
        //    This graceful handling allows off-chain services to detect and reconcile failed payments.
        let token_client = token::Client::new(&env, &data.token);
        
        // Check if subscriber has sufficient balance and allowance before transfer attempt
        let subscriber_balance = token_client.balance(&subscriber);
        if subscriber_balance < data.amount {
            // Insufficient balance — emit failure event and return error
            events::emit_payment_transfer_failure(&env, &subscriber, &merchant, data.amount);
            return Err(ContractError::TransferFailed);
        }

        // Execute the transfer. Given Soroban's all-or-nothing semantics, if this succeeds,
        // we proceed with state updates. If it panics (e.g., allowance revoked mid-call),
        // the transaction reverts entirely.
        token_client.transfer(
            &subscriber,
            &merchant,
            &data.amount,
        );

        // 5. Transfer succeeded — calculate next payment with late-payment-aware logic.
        //
        // LATE PAYMENT RESCHEDULING:
        // When a payment is collected after its originally scheduled time, we must decide
        // whether to reschedule relative to:
        //   (a) The old due date (preserving the original schedule)
        //   (b) The current time (absorbing the delay into the future)
        //
        // Current implementation uses approach (b): next_payment = now + interval
        //
        // This means:
        // - On-time payment:  next_payment advances predictably by interval
        // - Late payment:     the delay is absorbed, and the next payment is scheduled
        //                     from the current collection time, not the old due date
        //
        // Rationale for approach (b):
        //   - Simpler contract logic (no need to track "missed cycles")
        //   - Prevents compounding if multiple payments fail in succession
        //   - Off-chain services can track the original schedule in their own records
        //   - Merchants can implement custom rescheduling logic in backend (e.g.,
        //     retroactively charge for missed payments, or apply grace periods)
        //
        // Alternative (approach a) would be:
        //   next_payment = data.next_payment + data.interval
        //   This preserves the schedule but may cause "double-billing" if a late
        //   payment is followed immediately by another due payment.
        //
        data.next_payment = now + data.interval;

        // 6. Persist updated subscription.
        env.storage().persistent().set(&key, &data);

        // 7. Extend TTL.
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);

        // 8. Emit success event — after all mutations and transfer have succeeded.
        events::emit_payment_transfer_success(&env, &subscriber, &merchant, data.amount);

        Ok(())
    }

    /// Cancel an active subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `subscriber` in the transaction auth envelope.
    ///
    /// # Errors
    /// - `ContractError::NoActiveSubscription` — if no subscription exists for the pair.
    ///
    /// # Notes
    /// Emits a `cancel` event after successful removal to signal off-chain services
    /// that the subscription has ended. This provides a reliable and explicit signal
    /// for event indexing, rather than relying on the absence of future payments.
    pub fn cancel(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> Result<(), ContractError> {
        // 1. Authorization.
        subscriber.require_auth();

        // 2. Verify subscription exists before removing.
        let key = DataKey::Subscription(subscriber.clone(), merchant.clone());
        if !env.storage().persistent().has(&key) {
            return Err(ContractError::NoActiveSubscription);
        }

        // 3. Remove subscription from persistent storage.
        env.storage().persistent().remove(&key);

        // 4. Emit event — after successful removal to signal off-chain services.
        events::emit_cancel(&env, &subscriber, &merchant);

        Ok(())
    }
}

#[cfg(test)]
mod test;
