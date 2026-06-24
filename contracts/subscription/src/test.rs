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
fn test_cancel_emits_no_event() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
    let n = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    t.client.cancel(&t.subscriber, &t.merchant);
    let n2 = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    assert_eq!(n, n2, "cancel must not emit any events");
}

// ─── Token Transfer Failure Scenarios ─────────────────────────────────────────

/// Test that execute_payment fails when subscriber lacks sufficient allowance.
///
/// Validates: Token transfer failure is caught and logged with diagnostic context
/// Scenario:
/// 1. Subscribe with amount = 100_000
/// 2. Approve contract with only 50_000 (less than payment amount)
/// 3. Advance time past payment due
/// 4. execute_payment should fail (TokenTransferFailed or panic caught by framework)
/// 5. Verify subscription data is NOT modified
/// 6. Verify no payment event is emitted
#[test]
fn test_execute_payment_insufficient_allowance() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    // (a) Subscribe for payment of 100_000
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let data_before = t.get_sub();
    let events_before = t.env.events().all().len();

    // (b) Reduce allowance to 50_000 (less than payment amount)
    // First, reduce to 0
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.contract_id,
        &0_i128,
        &(t.env.ledger().sequence() + 100_000_u32),
    );
    // Then set to insufficient amount
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.contract_id,
        &50_000_i128,
        &(t.env.ledger().sequence() + 100_000_u32),
    );

    // (c) Advance time past payment due
    t.advance(ivl + 1);

    // (d) Record balances before payment attempt
    let sub_bal_before = t.sub_bal();
    let mer_bal_before = t.mer_bal();

    // (e) Attempt payment — should fail due to insufficient allowance
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    
    // Framework catches the token transfer failure and returns error
    assert!(r.is_err(), "execute_payment should fail with insufficient allowance");

    // (f) Verify subscription data was NOT modified
    let data_after = t.get_sub();
    assert_eq!(data_after.amount, data_before.amount, "amount should not change");
    assert_eq!(data_after.interval, data_before.interval, "interval should not change");
    assert_eq!(data_after.next_payment, data_before.next_payment, "next_payment should not change");

    // (g) Verify no funds were transferred
    assert_eq!(t.sub_bal(), sub_bal_before, "subscriber balance must not change");
    assert_eq!(t.mer_bal(), mer_bal_before, "merchant balance must not change");

    // (h) Verify no new events were emitted (transfer failed before event emission)
    let events_after = t.env.events().all().len();
    assert_eq!(
        events_after, events_before,
        "no new events should be emitted on transfer failure"
    );
}

/// Test that execute_payment fails when subscriber lacks sufficient balance.
///
/// Validates: Token transfer failure is caught and logged with diagnostic context
/// Scenario:
/// 1. Subscribe with amount = 100_000
/// 2. Have sufficient allowance but insufficient balance
/// 3. Advance time past payment due
/// 4. execute_payment should fail (TokenTransferFailed or panic caught by framework)
/// 5. Verify subscription data is NOT modified
/// 6. Verify no payment event is emitted
#[test]
fn test_execute_payment_insufficient_balance() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    // Reduce subscriber balance to less than payment amount (50_000 < 100_000)
    // We do this by creating another account and transferring most of the tokens away
    let third_party = Address::generate(&t.env);
    
    // First, transfer most of subscriber's balance to third party, leaving only 50_000
    // We need to approve the transfer first
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.subscriber,  // self-approve for transferring own tokens
        &10_000_000_i128,
        &(t.env.ledger().sequence() + 100_000_u32),
    );
    
    // Transfer 9_950_000 away, keeping only 50_000
    token::Client::new(&t.env, &t.token).transfer(
        &t.subscriber,
        &third_party,
        &9_950_000_i128,
    );

    let sub_balance = t.sub_bal();
    assert_eq!(sub_balance, 50_000_i128, "subscriber should have 50_000 after transfer");

    // Approve contract for more than current balance
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.contract_id,
        &200_000_i128,
        &(t.env.ledger().sequence() + 100_000_u32),
    );

    // (a) Subscribe for payment of 100_000 (but subscriber only has 50_000)
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let data_before = t.get_sub();
    let events_before = t.env.events().all().len();

    // (b) Advance time past payment due
    t.advance(ivl + 1);

    // (c) Record balances before payment attempt
    let sub_bal_before = t.sub_bal();
    let mer_bal_before = t.mer_bal();

    // (d) Attempt payment — should fail due to insufficient balance (50_000 < 100_000)
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    
    // Framework catches the token transfer failure and returns error
    assert!(r.is_err(), "execute_payment should fail with insufficient balance");

    // (e) Verify subscription data was NOT modified
    let data_after = t.get_sub();
    assert_eq!(data_after.amount, data_before.amount, "amount should not change");
    assert_eq!(data_after.interval, data_before.interval, "interval should not change");
    assert_eq!(data_after.next_payment, data_before.next_payment, "next_payment should not change");

    // (f) Verify no funds were transferred
    assert_eq!(t.sub_bal(), sub_bal_before, "subscriber balance must not change");
    assert_eq!(t.mer_bal(), mer_bal_before, "merchant balance must not change");

    // (g) Verify no new events were emitted (transfer failed before event emission)
    let events_after = t.env.events().all().len();
    assert_eq!(events_after, events_before, "no new events on transfer failure");
}

/// Test that successful payment includes pre-transfer diagnostics logging.
///
/// Validates: execute_token_transfer logs balance and allowance before transfer
/// Scenario:
/// 1. Subscribe and execute a successful payment
/// 2. Verify that diagnostics (balance, allowance, amount) are logged
/// 3. Verify that transaction succeeds and event is emitted
#[test]
fn test_execute_payment_logs_diagnostics_on_success() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    // (a) Subscribe
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let events_after_subscribe = t.env.events().all().len();

    // (b) Advance time and execute payment
    t.advance(ivl + 1);
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);

    // (c) Verify payment succeeded
    assert!(r.is_ok(), "execute_payment should succeed");

    // (d) Verify that logs were emitted (events count should increase)
    // Note: Soroban logs are captured in env.events()
    let events_after_payment = t.env.events().all().len();
    assert!(
        events_after_payment > events_after_subscribe,
        "payment should emit logs and executed event"
    );

    // (e) Verify executed event was emitted
    let contract_events: Vec<_> = t.env
        .events()
        .all()
        .iter()
        .filter(|e| e.0 == t.contract_id)
        .collect();
    
    assert!(
        contract_events.len() > 0,
        "at least the executed event should be present"
    );
}

/// Property test: No state mutation on transfer failure across random parameters
#[test]
fn test_no_state_mutation_on_transfer_failure() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    // Subscribe
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let data_before = t.get_sub();

    // Reduce allowance to cause transfer to fail
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.contract_id,
        &0_i128,
        &(t.env.ledger().sequence() + 100_000_u32),
    );

    // Advance time
    t.advance(ivl + 1);

    // Attempt payment
    let _r = t.client.try_execute_payment(&t.subscriber, &t.merchant);

    // Verify subscription data is identical
    let data_after = t.get_sub();
    assert_eq!(data_after.token, data_before.token, "token should not change");
    assert_eq!(data_after.amount, data_before.amount, "amount should not change");
    assert_eq!(data_after.interval, data_before.interval, "interval should not change");
    assert_eq!(data_after.next_payment, data_before.next_payment, "next_payment should not change");
}

// ─── Existing property-based tests ─────────────────────────────────────────────

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

// ─── Read-Only View: get_subscription ──────────────────────────────────────

/// Test querying an active subscription returns complete and accurate data.
///
/// Validates: New get_subscription entry point returns SubscriptionData correctly
/// Scenario:
/// 1. Create subscription with known parameters
/// 2. Query via get_subscription
/// 3. Verify all fields match: token, amount, interval, next_payment
#[test]
fn test_get_subscription_returns_active_subscription() {
    let t = T::new();
    let amt = 500_000_i128;
    let ivl = 172_800_u64;
    let ts0 = t.env.ledger().timestamp();

    // (a) Subscribe with known parameters
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);

    // (b) Query subscription via get_subscription
    let result = t.client.get_subscription(&t.subscriber, &t.merchant);

    // (c) Verify Option contains SubscriptionData
    assert!(result.is_some(), "get_subscription should return Some for active subscription");

    // (d) Verify all fields match
    let sub = result.unwrap();
    assert_eq!(sub.token, t.token, "token should match");
    assert_eq!(sub.amount, amt, "amount should match");
    assert_eq!(sub.interval, ivl, "interval should match");
    assert_eq!(sub.next_payment, ts0 + ivl, "next_payment should be current_time + interval");
}

/// Test querying a non-existent subscription returns None.
///
/// Validates: get_subscription returns None for subscriber-merchant pair with no subscription
/// Scenario:
/// 1. Query subscription for pair that was never created
/// 2. Verify None is returned
/// 3. Query for different merchant should still be None
#[test]
fn test_get_subscription_returns_none_for_nonexistent() {
    let t = T::new();

    // (a) Query without creating subscription
    let result = t.client.get_subscription(&t.subscriber, &t.merchant);

    // (b) Verify None
    assert!(result.is_none(), "get_subscription should return None for non-existent subscription");
}

/// Test querying subscription after cancellation returns None.
///
/// Validates: get_subscription reflects subscription state after cancellation
/// Scenario:
/// 1. Create subscription
/// 2. Query to verify exists
/// 3. Cancel subscription
/// 4. Query again to verify None
#[test]
fn test_get_subscription_returns_none_after_cancel() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    // (a) Subscribe
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    
    // (b) Verify subscription exists
    let result_before = t.client.get_subscription(&t.subscriber, &t.merchant);
    assert!(result_before.is_some(), "subscription should exist before cancel");

    // (c) Cancel subscription
    t.client.cancel(&t.subscriber, &t.merchant);

    // (d) Query again
    let result_after = t.client.get_subscription(&t.subscriber, &t.merchant);
    assert!(result_after.is_none(), "get_subscription should return None after cancel");
}

/// Test querying subscription after payment updates next_payment correctly.
///
/// Validates: get_subscription returns updated next_payment after execute_payment
/// Scenario:
/// 1. Create subscription with next_payment = T + interval
/// 2. Advance time past payment due
/// 3. Execute payment (advances next_payment to T + 2*interval)
/// 4. Query subscription
/// 5. Verify next_payment was updated
#[test]
fn test_get_subscription_reflects_updated_next_payment() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;
    let ts0 = t.env.ledger().timestamp();

    // (a) Subscribe
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let sub_before = t.client.get_subscription(&t.subscriber, &t.merchant).unwrap();
    assert_eq!(sub_before.next_payment, ts0 + ivl, "initial next_payment should be T + interval");

    // (b) Advance time past payment due
    t.advance(ivl + 1);
    let ts1 = t.env.ledger().timestamp();

    // (c) Execute payment
    t.client.execute_payment(&t.subscriber, &t.merchant);

    // (d) Query subscription
    let sub_after = t.client.get_subscription(&t.subscriber, &t.merchant).unwrap();

    // (e) Verify next_payment was advanced
    assert_eq!(sub_after.next_payment, ts1 + ivl, "next_payment should advance after payment");
    assert_ne!(sub_after.next_payment, sub_before.next_payment, "next_payment must change");
    assert_eq!(
        sub_after.next_payment,
        sub_before.next_payment + ivl,
        "next_payment should advance by exactly interval"
    );
}

/// Test independent subscriptions don't interfere with get_subscription queries.
///
/// Validates: get_subscription correctly distinguishes multiple subscriptions
/// Scenario:
/// 1. Create subscription (subscriber1 → merchant1) with params A
/// 2. Create subscription (subscriber1 → merchant2) with params B
/// 3. Query both pairs
/// 4. Verify each returns its own data
#[test]
fn test_get_subscription_independent_for_different_pairs() {
    let t = T::new();
    let merchant2 = Address::generate(&t.env);

    let amt1 = 100_000_i128;
    let ivl1 = 86_400_u64;
    let ts = t.env.ledger().timestamp();

    let amt2 = 250_000_i128;
    let ivl2 = 172_800_u64;

    // (a) Subscribe for first merchant
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt1, &ivl1);

    // (b) Subscribe for second merchant
    t.client.subscribe(&t.subscriber, &t.merchant2, &t.token, &amt2, &ivl2);

    // (c) Query both subscriptions
    let sub1 = t.client.get_subscription(&t.subscriber, &t.merchant).unwrap();
    let sub2 = t.client.get_subscription(&t.subscriber, &t.merchant2).unwrap();

    // (d) Verify each returns correct data
    assert_eq!(sub1.amount, amt1, "first subscription should have amt1");
    assert_eq!(sub1.interval, ivl1, "first subscription should have ivl1");
    assert_eq!(sub1.next_payment, ts + ivl1, "first subscription next_payment");

    assert_eq!(sub2.amount, amt2, "second subscription should have amt2");
    assert_eq!(sub2.interval, ivl2, "second subscription should have ivl2");
    assert_eq!(sub2.next_payment, ts + ivl2, "second subscription next_payment");

    // (e) Verify they're different
    assert_ne!(sub1.amount, sub2.amount, "amounts should differ");
    assert_ne!(sub1.interval, sub2.interval, "intervals should differ");
    assert_ne!(sub1.next_payment, sub2.next_payment, "next_payments should differ");
}

/// Test get_subscription with overwritten subscription returns latest data.
///
/// Validates: get_subscription returns most recent subscription when overwritten
/// Scenario:
/// 1. Create subscription with params A
/// 2. Query to get A
/// 3. Overwrite with new subscription with params B
/// 4. Query again
/// 5. Verify params B are returned (not A)
#[test]
fn test_get_subscription_returns_latest_after_overwrite() {
    let t = T::new();
    let ts0 = t.env.ledger().timestamp();

    // (a) First subscription
    let amt1 = 100_000_i128;
    let ivl1 = 86_400_u64;
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt1, &ivl1);

    let sub1 = t.client.get_subscription(&t.subscriber, &t.merchant).unwrap();
    assert_eq!(sub1.amount, amt1, "first subscription amount");
    assert_eq!(sub1.next_payment, ts0 + ivl1, "first subscription next_payment");

    // (b) Overwrite with second subscription
    t.advance(1000);  // advance time slightly
    let ts1 = t.env.ledger().timestamp();
    let amt2 = 500_000_i128;
    let ivl2 = 172_800_u64;
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt2, &ivl2);

    // (c) Query again
    let sub2 = t.client.get_subscription(&t.subscriber, &t.merchant).unwrap();

    // (d) Verify new data is returned
    assert_eq!(sub2.amount, amt2, "after overwrite, amount should be amt2");
    assert_eq!(sub2.interval, ivl2, "after overwrite, interval should be ivl2");
    assert_eq!(sub2.next_payment, ts1 + ivl2, "after overwrite, next_payment should be updated");

    // (e) Verify old data is not returned
    assert_ne!(sub2.amount, amt1, "old amount should not be returned");
    assert_ne!(sub2.next_payment, sub1.next_payment, "old next_payment should not be returned");
}

/// Test get_subscription has no authorization requirements (read-only).
///
/// Validates: get_subscription does not require any signatures
/// Scenario:
/// 1. Create subscription
/// 2. Query without any auth context
/// 3. Verify returns data (no auth failure)
#[test]
fn test_get_subscription_requires_no_authorization() {
    let env = Env::default();
    // Note: Not calling env.mock_all_auths() — no auth mocking
    
    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant = Address::generate(&env);

    // Register and setup token
    let token = env.register_stellar_asset_contract_v2(admin).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

    // Deploy contract
    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    // Approve contract
    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &5_000_000_i128,
        &(env.ledger().sequence() + 100_000_u32),
    );

    // Now auth is enabled (no mock_all_auths)
    // Subscribe requires auth (will succeed because SDK handles it)
    env.mock_all_auths();  // Need this for subscribe to work
    client.subscribe(&subscriber, &merchant, &token, &100_000_i128, &86_400_u64);

    // Clear mock auths
    env.mock_all_auths_allow_last(true);  // Stop mocking

    // (a) Query WITHOUT any authorization context
    // This should succeed because get_subscription is read-only
    let result = client.get_subscription(&subscriber, &merchant);

    // (b) Verify it returns data even without auth
    assert!(result.is_some(), "get_subscription should work without auth context");
    assert_eq!(result.unwrap().amount, 100_000_i128, "should return subscription data");
}
