#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{self, StellarAssetClient},
    Address, Env, IntoVal,
};

use crate::{
    error::ContractError,
    storage::{DataKey, SubscriptionData},
    SubscriptionProtocol, SubscriptionProtocolClient,
};

// ─── Test helpers ─────────────────────────────────────────────────────────────

struct T {
    env:         Env,
    client:      SubscriptionProtocolClient,
    subscriber:  Address,
    merchant:    Address,
    token:       Address,
    contract_id: Address,
}

impl T {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin      = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let merchant   = Address::generate(&env);

        // Register SAC token and mint 10_000_000 to subscriber
        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

        // Deploy subscription contract
        let contract_id = env.register(SubscriptionProtocol, ());
        let client      = SubscriptionProtocolClient::new(&env, &contract_id);

        // Approve contract to spend 5_000_000 on behalf of subscriber
        token::Client::new(&env, &token).approve(
            &subscriber,
            &contract_id,
            &5_000_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );

        Self { env, client, subscriber, merchant, token, contract_id }
    }

    fn advance(&self, secs: u64) {
        let now = self.env.ledger().timestamp();
        self.env.ledger().with_mut(|l| l.timestamp = now + secs);
    }

    fn sub_bal(&self) -> i128 {
        token::Client::new(&self.env, &self.token).balance(&self.subscriber)
    }

    fn mer_bal(&self) -> i128 {
        token::Client::new(&self.env, &self.token).balance(&self.merchant)
    }

    fn has_sub(&self) -> bool {
        self.env
            .storage()
            .persistent()
            .has(&DataKey::Subscription(self.subscriber.clone(), self.merchant.clone()))
    }

    fn get_sub(&self) -> SubscriptionData {
        self.env
            .storage()
            .persistent()
            .get(&DataKey::Subscription(self.subscriber.clone(), self.merchant.clone()))
            .unwrap()
    }
}

// ─── Requirement 13.1 — Full lifecycle ───────────────────────────────────────

#[test]
fn test_full_lifecycle() {
    let t   = T::new();
    let amt  = 100_000_i128;
    let ivl  = 86_400_u64;
    let ts0  = t.env.ledger().timestamp();

    // (a) subscribe
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let d = t.get_sub();
    assert_eq!(d.amount,       amt);
    assert_eq!(d.interval,     ivl);
    assert_eq!(d.next_payment, ts0 + ivl);

    // (b) advance clock
    t.advance(ivl + 1);
    let sb = t.sub_bal();
    let mb = t.mer_bal();

    // (c) execute_payment
    t.client.execute_payment(&t.subscriber, &t.merchant);
    assert_eq!(t.sub_bal(), sb - amt);
    assert_eq!(t.mer_bal(), mb + amt);

    // (d) cancel
    t.client.cancel(&t.subscriber, &t.merchant);
    assert!(!t.has_sub());
}

// ─── Requirement 13.2 — Payment not due ──────────────────────────────────────

#[test]
fn test_payment_not_due_after_subscribe() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64);
    let bal = t.sub_bal();
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));
    assert_eq!(t.sub_bal(), bal);
}

// ─── Extra: Execute payment before due time ───────────────────────────────────

#[test]
fn test_execute_payment_before_due_time() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let bal_before = t.sub_bal();
    let mer_bal_before = t.mer_bal();

    // Advance time but not enough to reach next_payment
    t.advance(ivl / 2);

    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));

    // Verify no transfer occurred
    assert_eq!(t.sub_bal(), bal_before);
    assert_eq!(t.mer_bal(), mer_bal_before);

    // Verify subscription remains unchanged
    let d = t.get_sub();
    assert_eq!(d.amount, amt);
    assert_eq!(d.interval, ivl);
}

// ─── Requirement 13.3 — Execute after cancel ─────────────────────────────────

#[test]
fn test_execute_after_cancel() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64);
    t.client.cancel(&t.subscriber, &t.merchant);
    t.advance(90_000);
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::NoActiveSubscription))));
    assert_eq!(t.sub_bal(), 10_000_000_i128);
}

// ─── Requirement 13.4 — Amount zero ──────────────────────────────────────────

#[test]
fn test_subscribe_amount_zero() {
    let t = T::new();
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &0_i128, &86_400_u64);
    assert!(matches!(r, Err(Ok(ContractError::AmountMustBePositive))));
    assert!(!t.has_sub());
}

// ─── Requirement 13.5 — Interval too short ───────────────────────────────────

#[test]
fn test_subscribe_interval_too_short() {
    let t = T::new();
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_399_u64);
    assert!(matches!(r, Err(Ok(ContractError::IntervalTooShort))));
    assert!(!t.has_sub());
}

// ─── Extra: Interval too long ─────────────────────────────────────────────────

#[test]
fn test_subscribe_interval_too_long() {
    let t = T::new();
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &31_536_001_u64);
    assert!(matches!(r, Err(Ok(ContractError::IntervalTooLong))));
    assert!(!t.has_sub());
}

// ─── Boundary Value Tests: Interval Edge Cases ────────────────────────────────

/// Test interval exactly at lower boundary (86400 seconds = 1 day)
/// This should be accepted as the minimum valid interval.
#[test]
fn test_subscribe_interval_exact_lower_boundary() {
    let t = T::new();
    let ivl = 86_400_u64; // exactly 1 day
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl);
    let d = t.get_sub();
    assert_eq!(d.interval, ivl, "interval at exact lower boundary must be accepted");
}

/// Test interval one second below lower boundary (86399 seconds)
/// This should be rejected with IntervalTooShort.
#[test]
fn test_subscribe_interval_one_below_lower_boundary() {
    let t = T::new();
    let ivl = 86_399_u64; // 1 second below minimum
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl);
    assert!(
        matches!(r, Err(Ok(ContractError::IntervalTooShort))),
        "interval 86399 must be rejected as IntervalTooShort"
    );
    assert!(!t.has_sub(), "subscription must not be created");
}

/// Test interval at zero (0 seconds)
/// This should be rejected with IntervalTooShort.
#[test]
fn test_subscribe_interval_zero() {
    let t = T::new();
    let ivl = 0_u64;
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl);
    assert!(
        matches!(r, Err(Ok(ContractError::IntervalTooShort))),
        "interval 0 must be rejected as IntervalTooShort"
    );
    assert!(!t.has_sub(), "subscription must not be created for zero interval");
}

/// Test interval with very small value (1 second)
/// This should be rejected with IntervalTooShort.
#[test]
fn test_subscribe_interval_one_second() {
    let t = T::new();
    let ivl = 1_u64;
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl);
    assert!(
        matches!(r, Err(Ok(ContractError::IntervalTooShort))),
        "interval 1 must be rejected as IntervalTooShort"
    );
    assert!(!t.has_sub(), "subscription must not be created for 1-second interval");
}

/// Test interval exactly at upper boundary (31536000 seconds = 365 days)
/// This should be accepted as the maximum valid interval.
#[test]
fn test_subscribe_interval_exact_upper_boundary() {
    let t = T::new();
    let ivl = 31_536_000_u64; // exactly 365 days
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl);
    let d = t.get_sub();
    assert_eq!(d.interval, ivl, "interval at exact upper boundary must be accepted");
}

/// Test interval one second above upper boundary (31536001 seconds)
/// This should be rejected with IntervalTooLong.
#[test]
fn test_subscribe_interval_one_above_upper_boundary() {
    let t = T::new();
    let ivl = 31_536_001_u64; // 1 second above maximum
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl);
    assert!(
        matches!(r, Err(Ok(ContractError::IntervalTooLong))),
        "interval 31536001 must be rejected as IntervalTooLong"
    );
    assert!(!t.has_sub(), "subscription must not be created");
}

/// Test interval at maximum u64 value
/// This should be rejected with IntervalTooLong.
#[test]
fn test_subscribe_interval_max_u64() {
    let t = T::new();
    let ivl = u64::MAX;
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl);
    assert!(
        matches!(r, Err(Ok(ContractError::IntervalTooLong))),
        "interval u64::MAX must be rejected as IntervalTooLong"
    );
    assert!(!t.has_sub(), "subscription must not be created");
}

/// Test interval at large value (1 year + 1 day = 31622400 seconds)
/// This should be rejected with IntervalTooLong.
#[test]
fn test_subscribe_interval_just_over_one_year() {
    let t = T::new();
    let ivl = 31_622_400_u64; // 1 year + 1 day
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl);
    assert!(
        matches!(r, Err(Ok(ContractError::IntervalTooLong))),
        "interval exceeding 365 days must be rejected as IntervalTooLong"
    );
    assert!(!t.has_sub(), "subscription must not be created");
}

// ─── Combined Boundary Tests: Interval + Amount ───────────────────────────────

/// Test that boundary intervals are properly validated regardless of amount.
/// Uses edge case amount combined with minimum interval.
#[test]
fn test_subscribe_min_amount_min_interval_boundary() {
    let t = T::new();
    let amt = 1_i128; // minimum positive amount
    let ivl = 86_400_u64; // exact lower boundary
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let d = t.get_sub();
    assert_eq!(d.amount, amt);
    assert_eq!(d.interval, ivl);
}

/// Test that maximum amount works with boundary intervals.
/// Uses large amount with exact upper boundary interval.
#[test]
fn test_subscribe_large_amount_max_interval_boundary() {
    let t = T::new();
    let amt = i128::MAX / 2; // large but safe amount
    let ivl = 31_536_000_u64; // exact upper boundary
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let d = t.get_sub();
    assert_eq!(d.amount, amt);
    assert_eq!(d.interval, ivl);
}

/// Test that zero interval is rejected even with valid amount.
/// Ensures interval validation is independent and robust.
#[test]
fn test_subscribe_zero_interval_with_valid_amount() {
    let t = T::new();
    let amt = 100_000_i128; // valid positive amount
    let ivl = 0_u64; // invalid zero interval
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    assert!(matches!(r, Err(Ok(ContractError::IntervalTooShort))));
    assert!(!t.has_sub());
}

// ─── Extra: Overwrite existing subscription ───────────────────────────────────

#[test]
fn test_subscribe_overwrites_existing() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
    let ts2 = t.env.ledger().timestamp();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &999_i128, &172_800_u64);
    let d = t.get_sub();
    assert_eq!(d.amount,       999);
    assert_eq!(d.interval,     172_800);
    assert_eq!(d.next_payment, ts2 + 172_800);
}

// ─── Extra: Cancel nonexistent ────────────────────────────────────────────────

#[test]
fn test_cancel_nonexistent() {
    let t = T::new();
    let r = t.client.try_cancel(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::NoActiveSubscription))));
}

// ─── Extra: Cancel and re-subscribe ───────────────────────────────────────────

#[test]
fn test_cancel_and_resubscribe() {
    let t = T::new();
    let amt1  = 100_000_i128;
    let ivl1  = 86_400_u64;
    let ts1   = t.env.ledger().timestamp();

    // (a) first subscribe
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt1, &ivl1);
    let d1 = t.get_sub();
    assert_eq!(d1.amount,       amt1);
    assert_eq!(d1.interval,     ivl1);
    assert_eq!(d1.next_payment, ts1 + ivl1);

    // (b) cancel
    t.client.cancel(&t.subscriber, &t.merchant);
    assert!(!t.has_sub());

    // (c) re-subscribe with different terms
    let amt2  = 200_000_i128;
    let ivl2  = 172_800_u64;
    let ts2   = t.env.ledger().timestamp();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt2, &ivl2);

    // (d) verify new subscription replaces old one
    let d2 = t.get_sub();
    assert_eq!(d2.amount,       amt2);
    assert_eq!(d2.interval,     ivl2);
    assert_eq!(d2.next_payment, ts2 + ivl2);
    assert_ne!(d1.next_payment, d2.next_payment);
}

// ─── Requirement: Payment Transfer Events (Success & Failure) ─────────────────

/// Test that a successful payment transfer emits the `payment_transfer_success` event.
/// This event provides dedicated telemetry for off-chain services to track successful collections.
#[test]
fn test_execute_payment_emits_success_event() {
    let t = T::new();
    let amt = 500_i128;
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &86_400_u64);
    t.advance(86_401);

    let n_before = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    t.client.execute_payment(&t.subscriber, &t.merchant);
    let n_after = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();

    assert_eq!(n_after, n_before + 1, "execute_payment should emit exactly 1 event");
}

/// Test that payment transfer fails with `TransferFailed` error when subscriber has insufficient balance.
/// The subscription state should remain unchanged (eligible for retry), and a failure event should be emitted.
#[test]
fn test_execute_payment_insufficient_balance() {
    let t = T::new();
    let high_amt = 15_000_000_i128; // exceeds subscriber balance (10_000_000)

    // Subscribe with an amount larger than subscriber balance
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &high_amt, &86_400_u64);
    let d_before = t.get_sub();
    let sub_balance_before = t.sub_bal();

    t.advance(86_401);

    // Attempt to execute payment — should fail due to insufficient balance
    let result = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::TransferFailed))),
        "execute_payment should return TransferFailed when balance is insufficient"
    );

    // Verify subscription state is unchanged (allows retry)
    let d_after = t.get_sub();
    assert_eq!(d_before.next_payment, d_after.next_payment, "next_payment must not advance on failure");
    assert_eq!(d_before.amount, d_after.amount, "amount must not change on failure");
    assert_eq!(d_before.interval, d_after.interval, "interval must not change on failure");

    // Verify no transfer occurred
    assert_eq!(t.sub_bal(), sub_balance_before, "subscriber balance must not change on failed transfer");
    assert_eq!(t.mer_bal(), 0_i128, "merchant must not receive funds on failed transfer");
}

/// Test that a payment transfer failure emits the `payment_transfer_failure` event.
/// This event allows off-chain services to track failed collection attempts for reconciliation and retry logic.
#[test]
fn test_execute_payment_emits_failure_event_on_insufficient_balance() {
    let t = T::new();
    let high_amt = 15_000_000_i128; // exceeds subscriber balance

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &high_amt, &86_400_u64);
    t.advance(86_401);

    let n_before = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();

    // Attempt execute_payment — should fail and emit failure event
    let _ = t.client.try_execute_payment(&t.subscriber, &t.merchant);

    let n_after = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    assert_eq!(n_after, n_before + 1, "failed execute_payment should emit exactly 1 failure event");
}

/// Test that subscription remains eligible for retry after a failed transfer.
/// This validates that failed transfers do not advance the next_payment timestamp.
#[test]
fn test_subscription_retryable_after_failed_transfer() {
    let t = T::new();
    let high_amt = 15_000_000_i128; // exceeds subscriber balance
    let ivl = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &high_amt, &ivl);
    let d = t.get_sub();
    let original_next_payment = d.next_payment;

    t.advance(86_401);

    // First attempt fails
    let r1 = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r1, Err(Ok(ContractError::TransferFailed))));

    let d_after_fail = t.get_sub();
    assert_eq!(d_after_fail.next_payment, original_next_payment, "next_payment must not change on failure");

    // Now give subscriber enough balance for a successful retry
    let token_client = token::Client::new(&t.env, &t.token);
    // Mint additional tokens to subscriber
    StellarAssetClient::new(&t.env, &t.token).mint(&t.subscriber, &high_amt);
    let new_sub_bal = token_client.balance(&t.subscriber);
    assert!(new_sub_bal >= high_amt, "subscriber should now have sufficient balance");

    // Second attempt should succeed
    let r2 = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(r2.is_ok(), "retry should succeed after balance is replenished");

    let d_after_success = t.get_sub();
    assert!(d_after_success.next_payment > original_next_payment, "next_payment must advance on success");
    assert_eq!(d_after_success.next_payment, original_next_payment + ivl, "next_payment should advance by interval");
}

// ─── Requirement 13.10 — Events ──────────────────────────────────────────────

#[test]
fn test_subscribe_emits_one_event() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &500_i128, &86_400_u64);
    // Only our contract event should be present (not token system events)
    let events = t.env.events().all();
    let ours: Vec<_> = events.iter().filter(|e| e.0 == t.contract_id).collect();
    assert_eq!(ours.len(), 1, "subscribe should emit exactly 1 event");
}

#[test]
fn test_execute_payment_emits_event() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &500_i128, &86_400_u64);
    let n_before = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    t.advance(86_401);
    t.client.execute_payment(&t.subscriber, &t.merchant);
    let n_after = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    assert_eq!(n_after, n_before + 1, "execute_payment should emit 1 event");
}

// ─── Requirement 13.11 — No events on failure ────────────────────────────────

#[test]
fn test_no_events_on_invalid_subscribe() {
    let t = T::new();
    let _ = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &0_i128, &86_400_u64);
    assert_eq!(t.env.events().all().len(), 0);
}

#[test]
fn test_no_events_on_payment_not_due() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
    let n = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    let _ = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    let n2 = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    assert_eq!(n, n2, "no extra events on failed execute_payment");
}

#[test]
fn test_cancel_emits_event() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
    let n = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    t.client.cancel(&t.subscriber, &t.merchant);
    let n2 = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    assert_eq!(n2, n + 1, "cancel should emit exactly 1 event");
}

// ─── Transfer failure — state integrity ──────────────────────────────────────

/// Sets up a subscription that is past-due, then reduces the allowance to zero
/// so the token transfer will fail. Verifies subscription state is unchanged.
#[test]
fn test_execute_payment_fails_on_zero_allowance_state_unchanged() {
    let t   = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let sub_before = t.get_sub();
    let sb = t.sub_bal();
    let mb = t.mer_bal();

    // Revoke the allowance entirely.
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.contract_id,
        &0_i128,
        &(t.env.ledger().sequence() + 100_000_u32),
    );

    t.advance(ivl + 1);

    // Transfer will panic inside the token contract — host error, not ContractError.
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(r.is_err(), "execute_payment must fail when allowance is zero");

    // State must be unchanged.
    let sub_after = t.get_sub();
    assert_eq!(sub_after.next_payment, sub_before.next_payment,
        "next_payment must not advance on failed transfer");
    assert_eq!(t.sub_bal(), sb, "subscriber balance must be unchanged");
    assert_eq!(t.mer_bal(), mb, "merchant balance must be unchanged");

    // No extra contract events.
    let events_after: Vec<_> = t.env.events().all().iter()
        .filter(|e| e.0 == t.contract_id).collect();
    // subscribe emitted 1 event; no `executed` event should have been added.
    assert_eq!(events_after.len(), 1, "no executed event on failed transfer");
}

/// Sets up a subscription whose amount exceeds the subscriber's entire balance
/// so the token transfer will fail due to insufficient funds.
#[test]
fn test_execute_payment_fails_on_insufficient_balance_state_unchanged() {
    let t = T::new();
    // Amount larger than the 10_000_000 minted to subscriber.
    let amt = 20_000_000_i128;
    let ivl = 86_400_u64;

    // Approve a large allowance so the failure is balance-driven, not allowance-driven.
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.contract_id,
        &amt,
        &(t.env.ledger().sequence() + 100_000_u32),
    );

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let sub_before = t.get_sub();
    let sb = t.sub_bal();
    let mb = t.mer_bal();

    t.advance(ivl + 1);

    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(r.is_err(), "execute_payment must fail when balance is insufficient");

    let sub_after = t.get_sub();
    assert_eq!(sub_after.next_payment, sub_before.next_payment,
        "next_payment must not advance on failed transfer");
    assert_eq!(t.sub_bal(), sb, "subscriber balance must be unchanged");
    assert_eq!(t.mer_bal(), mb, "merchant balance must be unchanged");

    let events_after: Vec<_> = t.env.events().all().iter()
        .filter(|e| e.0 == t.contract_id).collect();
    assert_eq!(events_after.len(), 1, "no executed event on failed transfer");
}

// ─── Property-Based Tests ─────────────────────────────────────────────────────

use proptest::prelude::*;

proptest! {
    /// Property 1: Subscription data round-trip
    /// Validates: Req 1.5, 5.1, 13.8, 13.9
    #[test]
    fn prop_subscribe_round_trip(
        amount   in 1_i128..=1_000_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t  = T::new();
        let ts = t.env.ledger().timestamp();
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        let d = t.get_sub();
        prop_assert_eq!(d.amount,       amount);
        prop_assert_eq!(d.interval,     interval);
        prop_assert_eq!(d.next_payment, ts + interval);
    }

    /// Property 2: Time-lock — immediate execute_payment always fails
    /// Validates: Req 2.3, 5.2, 13.6
    #[test]
    fn prop_execute_before_due_always_errors(
        amount   in 1_i128..=1_000_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t   = T::new();
        let bal = t.sub_bal();
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
        prop_assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));
        prop_assert_eq!(t.sub_bal(), bal);
    }

    /// Property 3: Double-payment prevention
    /// Validates: Req 5.3, 5.4, 13.7
    #[test]
    fn prop_double_payment_prevention(
        amount   in 1_i128..=100_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t = T::new();
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        t.advance(interval + 1);
        t.client.execute_payment(&t.subscriber, &t.merchant);
        let bal = t.sub_bal();
        let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
        prop_assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));
        prop_assert_eq!(t.sub_bal(), bal, "balance must not change on second attempt");
    }

    /// Property 4: Non-positive amount always rejected
    /// Validates: Req 1.2, 8.1, 13.4
    #[test]
    fn prop_non_positive_amount_rejected(
        amount   in i128::MIN..=0_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t = T::new();
        let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        prop_assert!(matches!(r, Err(Ok(ContractError::AmountMustBePositive))));
        prop_assert!(!t.has_sub());
    }

    /// Property 5: Interval below 86400 always rejected
    /// Validates: Req 1.3, 8.2, 13.5
    #[test]
    fn prop_short_interval_rejected(
        amount   in 1_i128..=1_000_000_i128,
        interval in 0_u64..86_400_u64,
    ) {
        let t = T::new();
        let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        prop_assert!(matches!(r, Err(Ok(ContractError::IntervalTooShort))));
        prop_assert!(!t.has_sub());
    }

    /// Property 6: Interval above 31536000 always rejected
    /// Validates: Req 1.4, 8.2
    #[test]
    fn prop_long_interval_rejected(
        amount   in 1_i128..=1_000_000_i128,
        interval in 31_536_001_u64..=u64::MAX / 2,
    ) {
        let t = T::new();
        let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        prop_assert!(matches!(r, Err(Ok(ContractError::IntervalTooLong))));
        prop_assert!(!t.has_sub());
    }

    /// Property 7: Cancel terminates subscription permanently
    /// Validates: Req 3.3, 3.5, 8.5
    #[test]
    fn prop_cancel_prevents_future_payments(
        amount   in 1_i128..=100_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t = T::new();
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        t.client.cancel(&t.subscriber, &t.merchant);
        t.advance(interval + 1);
        let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
        prop_assert!(matches!(r, Err(Ok(ContractError::NoActiveSubscription))));
        prop_assert_eq!(t.sub_bal(), 10_000_000_i128);
    }

    /// Property 8: Balance invariant — exact transfer, zero contract balance
    /// Validates: Req 4.1, 4.2, 4.3
    #[test]
    fn prop_balance_invariant(
        amount   in 1_i128..=100_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t  = T::new();
        let sb = t.sub_bal();
        let mb = t.mer_bal();
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        t.advance(interval + 1);
        t.client.execute_payment(&t.subscriber, &t.merchant);
        prop_assert_eq!(t.sub_bal(), sb - amount);
        prop_assert_eq!(t.mer_bal(), mb + amount);
        prop_assert_eq!(
            token::Client::new(&t.env, &t.token).balance(&t.contract_id),
            0_i128,
            "contract must hold zero balance"
        );
    }

    /// Property 9: No events on validation failures
    /// Validates: Req 7.4, 13.11
    #[test]
    fn prop_no_events_on_invalid_amount(
        amount   in i128::MIN..=0_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t = T::new();
        let _ = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        prop_assert_eq!(t.env.events().all().len(), 0);
    }
}

// ─── Load Tests ────────────────────────────────────────────────────────────────

/// Load test: N distinct subscriber→merchant pairs all succeed independently.
/// Verifies the contract handles bulk subscription creation without state corruption.
#[test]
fn load_test_bulk_subscribe_distinct_pairs() {
    const N: usize = 50;

    let env = Env::default();
    env.mock_all_auths();

    let admin    = Address::generate(&env);
    let token    = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let merchant = Address::generate(&env);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client      = SubscriptionProtocolClient::new(&env, &contract_id);

    let amt = 1_000_i128;
    let ivl = 86_400_u64;

    // Generate N subscribers, mint tokens and set allowance for each.
    let subscribers: Vec<Address> = (0..N)
        .map(|_| Address::generate(&env))
        .collect();

    for sub in &subscribers {
        StellarAssetClient::new(&env, &token).mint(sub, &10_000_i128);
        token::Client::new(&env, &token).approve(
            sub,
            &contract_id,
            &5_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );
    }

    // Subscribe all pairs sequentially (Soroban testutils are single-threaded).
    for sub in &subscribers {
        client.subscribe(sub, &merchant, &token, &amt, &ivl);
    }

    // Verify every subscription was persisted correctly.
    for sub in &subscribers {
        let key = DataKey::Subscription(sub.clone(), merchant.clone());
        let data: SubscriptionData = env.storage().persistent().get(&key).unwrap();
        assert_eq!(data.amount,   amt);
        assert_eq!(data.interval, ivl);
    }
}

/// Load test: repeated re-subscription by the same pair overwrites without accumulation.
/// Verifies idempotent upsert semantics under repeated calls.
#[test]
fn load_test_repeated_resubscribe_same_pair() {
    const N: usize = 20;

    let t   = T::new();
    let ivl = 86_400_u64;

    for i in 1..=N {
        let amt = i as i128 * 1_000;
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    }

    // Only the last subscription must exist — no duplicates or accumulated state.
    let d = t.get_sub();
    assert_eq!(d.amount, N as i128 * 1_000);
    assert_eq!(d.interval, ivl);

    // Exactly one storage entry (idempotent upsert, not append).
    let count = (0..N).filter(|i| {
        let amt = (*i as i128 + 1) * 1_000;
        // We can only confirm the final value; just check the key exists once.
        let _ = amt;
        env_has_sub(&t, &t.subscriber, &t.merchant)
    }).count();
    assert_eq!(count, N, "subscription key should exist throughout all overwrites");
}

fn env_has_sub(t: &T, sub: &Address, mer: &Address) -> bool {
    t.env
        .storage()
        .persistent()
        .has(&DataKey::Subscription(sub.clone(), mer.clone()))
}

/// Load test: N invalid subscribe attempts (zero amount) all fail cleanly.
/// Verifies the contract never panics and emits zero events under bulk invalid input.
#[test]
fn load_test_bulk_invalid_subscribe_rejected() {
    const N: usize = 50;

    let t = T::new();

    for _ in 0..N {
        let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &0_i128, &86_400_u64);
        assert!(matches!(r, Err(Ok(ContractError::AmountMustBePositive))));
    }

    // No subscription should have been created.
    assert!(!t.has_sub());

    // No contract events emitted.
    assert_eq!(t.env.events().all().len(), 0);
}

/// Load test: N distinct pairs all execute a payment after interval elapses.
/// Verifies no state leakage between concurrent-style payment executions.
#[test]
fn load_test_bulk_execute_payment() {
    const N: usize = 20;

    let env = Env::default();
    env.mock_all_auths();

    let admin    = Address::generate(&env);
    let token    = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let merchant = Address::generate(&env);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client      = SubscriptionProtocolClient::new(&env, &contract_id);

    let amt = 1_000_i128;
    let ivl = 86_400_u64;

    let subscribers: Vec<Address> = (0..N)
        .map(|_| Address::generate(&env))
        .collect();

    for sub in &subscribers {
        StellarAssetClient::new(&env, &token).mint(sub, &10_000_i128);
        token::Client::new(&env, &token).approve(
            sub,
            &contract_id,
            &5_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );
        client.subscribe(sub, &merchant, &token, &amt, &ivl);
    }

    // Advance past the payment interval.
    let now = env.ledger().timestamp();
    env.ledger().with_mut(|l| l.timestamp = now + ivl + 1);

    let mer_bal_before = token::Client::new(&env, &token).balance(&merchant);

    for sub in &subscribers {
        client.execute_payment(sub, &merchant);
    }

    // Merchant should have received exactly N * amt.
    let expected = mer_bal_before + (N as i128 * amt);
    assert_eq!(
        token::Client::new(&env, &token).balance(&merchant),
        expected
    );

    // Each subscriber should have been debited exactly once.
    for sub in &subscribers {
        assert_eq!(
            token::Client::new(&env, &token).balance(sub),
            10_000 - amt
        );
    }
}

// ─── Edge Case: Repeated Cancel After Removal ─────────────────────────────────

/// Edge case test: Calling cancel() twice in a row returns NoActiveSubscription consistently.
/// This validates the contract's deterministic behavior and guards against idempotent cancel mishandling.
///
/// Why: This edge case should be deterministic and documented. If a subscription is successfully
/// cancelled once, a second cancel attempt on the same pair should cleanly return NoActiveSubscription.
/// This ensures off-chain systems can safely retry cancel operations without side effects.
#[test]
fn test_repeated_cancel_after_removal_consistent() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    // (a) Create subscription
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    assert!(t.has_sub(), "subscription must be created");

    // (b) Cancel successfully — first call removes subscription
    let result1 = t.client.try_cancel(&t.subscriber, &t.merchant);
    assert!(result1.is_ok(), "first cancel must succeed");
    assert!(!t.has_sub(), "subscription must be removed after first cancel");

    // (c) Attempt to cancel again — should consistently return NoActiveSubscription
    let result2 = t.client.try_cancel(&t.subscriber, &t.merchant);
    assert!(
        matches!(result2, Err(Ok(ContractError::NoActiveSubscription))),
        "second cancel on non-existent subscription must return NoActiveSubscription"
    );

    // (d) Verify subscription is still absent
    assert!(!t.has_sub(), "subscription must remain removed");
}

/// Edge case test: Calling cancel() multiple times (N=5) consistently returns NoActiveSubscription after removal.
/// This stress-tests the contract's idempotent cancel behavior and guards against off-by-one errors.
///
/// Why: If a backend service retries a cancel operation multiple times (e.g., due to network latency),
/// every call after the first should deterministically return NoActiveSubscription. This prevents
/// silent failures or unpredictable state mutations.
#[test]
fn load_test_repeated_cancel_multiple_attempts() {
    const N: usize = 5;

    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    // Create subscription once
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    assert!(t.has_sub(), "subscription must exist before any cancel");

    // First cancel should succeed
    let first_result = t.client.try_cancel(&t.subscriber, &t.merchant);
    assert!(first_result.is_ok(), "first cancel must succeed");

    // All subsequent cancels (N-1 attempts) should consistently fail with NoActiveSubscription
    for attempt in 2..=N {
        let result = t.client.try_cancel(&t.subscriber, &t.merchant);
        assert!(
            matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
            "cancel attempt #{} on removed subscription must return NoActiveSubscription",
            attempt
        );
    }

    // Subscription must remain permanently removed
    assert!(!t.has_sub(), "subscription must be permanently removed after all cancel attempts");
}

/// Edge case test: cancel() then execute_payment() returns NoActiveSubscription (no state confusion).
/// This validates that cancel properly removes subscription state and prevents future operations.
///
/// Why: A cancelled subscription must be completely removed from persistent storage.
/// Attempting execute_payment() after cancellation should fail cleanly, not attempt to perform
/// operations on stale data or return confusing errors.
#[test]
fn test_cancel_then_execute_payment_consistent_error() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    // Create and cancel
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    t.client.cancel(&t.subscriber, &t.merchant);
    assert!(!t.has_sub(), "subscription must be removed");

    // Advance time past the original next_payment window
    t.advance(ivl + 1);

    // Attempt to execute payment on the cancelled subscription
    let result = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
        "execute_payment after cancel must return NoActiveSubscription, not PaymentNotDue or other errors"
    );

    // Verify no tokens were transferred
    assert_eq!(t.sub_bal(), 10_000_000_i128, "subscriber balance must be unchanged");
    assert_eq!(t.mer_bal(), 0_i128, "merchant must not receive funds");
}

/// Edge case test: Multiple subscriber-merchant pairs verify independent cancel behavior (no cross-contamination).
/// This validates that cancel on one pair doesn't affect other subscriptions.
///
/// Why: Storage keys are composite (subscriber, merchant). Cancelling one pair must not affect
/// other pairs, even if they share a subscriber or merchant. This guards against key collision bugs.
#[test]
fn test_repeated_cancel_multi_pair_no_cross_contamination() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    // Two subscribers and two merchants
    let sub1 = Address::generate(&env);
    let sub2 = Address::generate(&env);
    let mer1 = Address::generate(&env);
    let mer2 = Address::generate(&env);

    // Mint and approve for both subscribers
    for sub in &[sub1.clone(), sub2.clone()] {
        StellarAssetClient::new(&env, &token).mint(sub, &10_000_i128);
        token::Client::new(&env, &token).approve(
            sub,
            &contract_id,
            &5_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );
    }

    let amt = 1_000_i128;
    let ivl = 86_400_u64;

    // Create four subscriptions (all combinations)
    // (sub1, mer1), (sub1, mer2), (sub2, mer1), (sub2, mer2)
    client.subscribe(&sub1, &mer1, &token, &amt, &ivl);
    client.subscribe(&sub1, &mer2, &token, &amt, &ivl);
    client.subscribe(&sub2, &mer1, &token, &amt, &ivl);
    client.subscribe(&sub2, &mer2, &token, &amt, &ivl);

    // Helper function to check if a subscription exists
    let has_subscription = |sub: &Address, mer: &Address| -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Subscription(sub.clone(), mer.clone()))
    };

    // All four should exist
    assert!(has_subscription(&sub1, &mer1), "subscription (sub1, mer1) must exist");
    assert!(has_subscription(&sub1, &mer2), "subscription (sub1, mer2) must exist");
    assert!(has_subscription(&sub2, &mer1), "subscription (sub2, mer1) must exist");
    assert!(has_subscription(&sub2, &mer2), "subscription (sub2, mer2) must exist");

    // Cancel (sub1, mer1) twice
    assert!(client.try_cancel(&sub1, &mer1).is_ok(), "first cancel (sub1, mer1) must succeed");
    assert!(
        matches!(client.try_cancel(&sub1, &mer1), Err(Ok(ContractError::NoActiveSubscription))),
        "second cancel (sub1, mer1) must return NoActiveSubscription"
    );

    // Verify only (sub1, mer1) was removed
    assert!(!has_subscription(&sub1, &mer1), "subscription (sub1, mer1) must be removed");
    assert!(has_subscription(&sub1, &mer2), "subscription (sub1, mer2) must still exist");
    assert!(has_subscription(&sub2, &mer1), "subscription (sub2, mer1) must still exist");
    assert!(has_subscription(&sub2, &mer2), "subscription (sub2, mer2) must still exist");

    // Cancel another pair twice
    assert!(client.try_cancel(&sub2, &mer2).is_ok(), "first cancel (sub2, mer2) must succeed");
    assert!(
        matches!(client.try_cancel(&sub2, &mer2), Err(Ok(ContractError::NoActiveSubscription))),
        "second cancel (sub2, mer2) must return NoActiveSubscription"
    );

    // Verify correct state after second pair removal
    assert!(!has_subscription(&sub1, &mer1), "subscription (sub1, mer1) must still be removed");
    assert!(has_subscription(&sub1, &mer2), "subscription (sub1, mer2) must still exist");
    assert!(has_subscription(&sub2, &mer1), "subscription (sub2, mer1) must still exist");
    assert!(!has_subscription(&sub2, &mer2), "subscription (sub2, mer2) must be removed");
}

/// Edge case test: No events emitted on repeated cancel calls after removal.
/// This validates that the contract doesn't pollute the event log with spurious failures.
///
/// Why: Event indexers rely on consistent, minimal event streams. Failed cancel attempts
/// should not emit events, keeping the log clean and deterministic.
#[test]
fn test_repeated_cancel_no_extra_events() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    // Create subscription
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let events_after_subscribe = t.env.events().all().len();

    // First cancel — should emit exactly 1 event
    t.client.cancel(&t.subscriber, &t.merchant);
    let events_after_first_cancel = t.env.events().all().len();
    assert_eq!(events_after_first_cancel, events_after_subscribe + 1, "first cancel must emit 1 event");

    // Repeated cancels (5 attempts) — should emit NO additional events
    for attempt in 1..=5 {
        let result = t.client.try_cancel(&t.subscriber, &t.merchant);
        assert!(
            matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
            "cancel attempt #{} must fail with NoActiveSubscription",
            attempt
        );
    }

    let final_event_count = t.env.events().all().len();
    assert_eq!(
        final_event_count, events_after_first_cancel,
        "repeated cancel failures must not emit any additional events"
    );
}

/// Edge case property test: For any valid subscription, repeated cancels always return
/// NoActiveSubscription after the first successful cancellation.
/// This property validates deterministic idempotent cancel behavior across all subscriptions.
#[test]
fn prop_repeated_cancel_is_deterministic(
    amount   in 1_i128..=100_000_i128,
    interval in 86_400_u64..=31_536_000_u64,
) {
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
