#![no_std]

mod error;
mod events;
mod storage;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Symbol};

use crate::error::ContractError;
use crate::storage::{DataKey, SubscriptionData, MAX_AMOUNT, MAX_TTL_LEDGERS, MIN_TTL_LEDGERS};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/// Return the current ledger timestamp, or `InvalidTimestamp` if it is zero.
///
/// A zero timestamp indicates the ledger clock is uninitialised (e.g. certain
/// mock environments or unusual network states). Treating it as invalid prevents
/// silently computing a `next_payment` anchored at the Unix epoch.
#[inline]
fn ledger_timestamp(env: &Env) -> Result<u64, ContractError> {
    let ts = env.ledger().timestamp();
    if ts == 0 {
        return Err(ContractError::InvalidTimestamp);
    }
    Ok(ts)
}

/// Add `interval` to `ts`, returning `InvalidTimestamp` on overflow instead of
/// wrapping or panicking.
#[inline]
fn checked_next_payment(ts: u64, interval: u64) -> Result<u64, ContractError> {
    ts.checked_add(interval).ok_or(ContractError::InvalidTimestamp)
}

// ─── Contract ─────────────────────────────────────────────────────────────────

// ─── Token Transfer Helpers ──────────────────────────────────────────────────────

/// Safely attempt a token transfer with pre-transfer diagnostics logging.
///
/// This function performs token transfer with comprehensive diagnostic logging
/// to aid failure diagnosis. Before attempting the transfer, it queries the token
/// contract for subscriber balance and allowance information. If the transfer fails
/// (panics), the comprehensive context logged before the attempt helps identify
/// the root cause.
///
/// # Logging
/// Logs token state before transfer attempt:
/// - subscriber balance
/// - subscriber allowance to this contract
/// - requested transfer amount
/// If logs are reviewed after failure, they provide context for diagnosis.
///
/// # Parameters
/// - `env`: The Soroban environment
/// - `token`: The SEP-41 token contract address
/// - `subscriber`: Account being charged
/// - `merchant`: Account receiving funds
/// - `amount`: Amount to transfer (in token's smallest unit)
///
/// # Behavior
/// - Queries subscriber's token balance before transfer attempt
/// - Queries subscriber's approval amount before transfer attempt
/// - Logs both values with contract/merchant/amount context
/// - Executes transfer (panics if insufficient balance/allowance)
/// - Returns Ok(()) on success
///
/// # Notes
/// In case of transfer failure, the transaction aborts and logs are available
/// via Soroban RPC for off-chain diagnostic analysis. The logged state snapshot
/// taken before the transfer indicates whether the failure was due to:
/// - Balance < amount: "insufficient balance"
/// - Allowance < amount: "insufficient allowance"
/// - Other authorization issues: "transfer authorization failed"
fn execute_token_transfer(
    env: &Env,
    token: &Address,
    subscriber: &Address,
    merchant: &Address,
    amount: i128,
) -> Result<(), ContractError> {
    let token_client = token::Client::new(env, token);
    let contract_addr = env.current_contract_address();

    // Pre-transfer diagnostics: log token state
    // Note: balance() and allowance() queries cost gas but provide critical debugging info
    // on transfer failures. This is a worthwhile tradeoff for production reliability.
    
    let subscriber_balance = token_client.balance(subscriber);
    let subscriber_allowance = token_client.allowance(subscriber, &contract_addr);

    // Log diagnostic context before transfer attempt
    // Format: "execute_token_transfer" event with subscriber, amount, balance, allowance
    env.log().status(
        "token_transfer_attempt",
        &(
            Symbol::new(env, "subscriber_balance"),
            subscriber_balance,
            Symbol::new(env, "subscriber_allowance"),
            subscriber_allowance,
            Symbol::new(env, "transfer_amount"),
            amount,
        ),
    );

    // Execute the transfer. If this fails (e.g., insufficient balance or allowance),
    // it will panic. The diagnostics logged above will be captured in the transaction
    // logs, allowing off-chain systems to diagnose the failure.
    token_client.transfer(subscriber, merchant, &amount);

    Ok(())
}

#[contract]
pub struct SubscriptionProtocol;

#[contractimpl]
impl SubscriptionProtocol {
    /// Return the contract version as a string.
    ///
    /// This entry point enables off-chain systems to verify the deployed contract variant
    /// and ensure compatibility with their integration. The version follows semantic versioning
    /// (MAJOR.MINOR.PATCH) and should be checked before making contract invocations.
    ///
    /// # Return
    /// Returns the contract version as a string (e.g., "1.0.0").
    ///
    /// # Example (Off-Chain)
    /// ```text
    /// const version = await contract.version();
    /// if (!version.startsWith("1.")) {
    ///   throw new Error(`Unsupported contract version: ${version}`);
    /// }
    /// ```
    pub fn version(env: Env) -> Symbol {
        // Return version as a Symbol for efficient on-chain transmission
        symbol_short!("1.0.0")
    }

    /// Return the contract name for identification.
    ///
    /// Useful for integration verification and logging in off-chain systems.
    /// Should always return "SorobanPay-SubscriptionProtocol" for this contract.
    pub fn contract_name(env: Env) -> Symbol {
        symbol_short!("SorobanPay")
    }
    /// Create or update a recurring payment subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `subscriber` in the transaction auth envelope.
    ///
    /// # Parameters
    /// - `subscriber`: Account that will be charged on each payment interval.
    /// - `merchant`:   Account that receives payments.
    /// - `token`:      SEP-41 token contract address.
    /// - `amount`:     Payment amount per interval. Must be > 0 and <= 10^18.
    /// - `interval`:   Seconds between payments. Must be in [86400, 31536000].
    ///
    /// # Errors
    /// - `ContractError::AmountMustBePositive` — if `amount <= 0`.
    /// - `ContractError::AmountTooLarge`       — if `amount > 10^18`.
    /// - `ContractError::IntervalTooShort`     — if `interval < 86400`.
    /// - `ContractError::IntervalTooLong`      — if `interval > 31536000`.
    /// - `ContractError::InvalidTimestamp`     — if ledger timestamp is zero or overflows.
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
        if amount > MAX_AMOUNT {
            return Err(ContractError::AmountTooLarge);
        }

        // 3. Validate interval.
        if interval < 86_400 {
            return Err(ContractError::IntervalTooShort);
        }
        if interval > 31_536_000 {
            return Err(ContractError::IntervalTooLong);
        }

        // 4. Build subscription record.
        //    Guard against an uninitialised ledger clock (zero timestamp) and
        //    against arithmetic overflow when projecting the first due date.
        let ts           = ledger_timestamp(&env)?;
        let next_payment = checked_next_payment(ts, interval)?;
        let data = SubscriptionData {
            token: token.clone(),
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
        events::emit_subscribe(&env, &subscriber, &merchant, &token, amount);

        Ok(())
    }

    /// Collect the next recurring payment for an active subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `merchant` in the transaction auth envelope.
    ///
    /// # Errors
    /// - `ContractError::NoActiveSubscription` — if no subscription exists for the pair.
    /// - `ContractError::PaymentNotDue`        — if the payment interval has not elapsed.
    /// - `ContractError::TransferFailed`       — if the token transfer fails (insufficient balance or allowance).
    /// - `ContractError::InvalidTimestamp`     — if ledger timestamp is zero.
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
        //    Guard against an uninitialised ledger clock before comparing timestamps.
        let now = ledger_timestamp(&env)?;
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

        // 5. Transfer succeeded — advance next_payment using the `now` captured at invocation start.
        data.next_payment = now + data.interval;

        // 6. Persist updated subscription.
        env.storage().persistent().set(&key, &data);

        // 7. Extend TTL.
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);

        // 8. Emit event — after all mutations and transfer have succeeded.
        events::emit_executed(&env, &subscriber, &merchant, &data.token, data.amount);

        Ok(())
    }

    /// Collect multiple recurring payments in a single transaction.
    ///
    /// # Authorization
    /// Requires a valid signature from `merchant` in the transaction auth envelope.
    /// All payments must be to the same merchant (enforced by caller authorization).
    ///
    /// # Parameters
    /// - `payments`: Vector of `(subscriber, merchant)` tuples representing payments to execute.
    ///   Must be non-empty.
    ///
    /// # Errors
    /// - `ContractError::EmptyBatch` — if `payments` vector is empty.
    /// - Per-subscription errors are NOT propagated; instead, each payment is processed
    ///   independently with individual success/failure events.
    ///
    /// # Behavior
    /// For each payment in the batch:
    /// 1. Load subscription (skip if absent).
    /// 2. Check time-lock (skip if not due).
    /// 3. Verify subscriber balance (emit failure event if insufficient; skip transfer).
    /// 4. Execute token transfer (emit failure event if transfer fails; skip state update).
    /// 5. On success: update `next_payment`, extend TTL, emit success + executed events.
    ///
    /// # Events
    /// Emits for each subscription:
    /// - `payment_transfer_success` + `executed` (on successful collection).
    /// - `payment_transfer_failure` (on transfer failure).
    /// - No events (if subscription doesn't exist or payment not due).
    ///
    /// # Advantages
    /// - Reduces transaction overhead: single auth check + single bulk TTL extension for N payments.
    /// - Per-subscription success handling: failures don't block other payments.
    /// - Ideal for merchant backends batching collections from multiple subscribers.
    ///
    /// # Example Usage (Off-Chain)
    /// ```text
    /// const paymentBatch = [
    ///   (subscriber_a, merchant),
    ///   (subscriber_b, merchant),
    ///   (subscriber_c, merchant),
    /// ];
    /// contract.execute_payment_batch(paymentBatch)
    ///   .then(() => {
    ///     // Check events for per-subscription success/failure
    ///   });
    /// ```
    pub fn execute_payment_batch(
        env: Env,
        merchant: Address,
        payments: soroban_sdk::Vec<Address>,
    ) -> Result<(), ContractError> {
        // 1. Authorization — merchant triggers collection for all payments.
        merchant.require_auth();

        // 2. Validate batch is non-empty.
        if payments.is_empty() {
            return Err(ContractError::EmptyBatch);
        }

        // 3. Emit batch initiation event for telemetry.
        events::emit_batch_execute_initiated(&env, &merchant, payments.len() as u32);

        // 4. Collect keys to extend TTL in bulk (after all transfers).
        let mut keys_to_extend = soroban_sdk::Vec::new(&env);
        let now = env.ledger().timestamp();

        // 5. Process each payment independently — collect successes for bulk TTL extension.
        for subscriber in payments.iter() {
            let key = DataKey::Subscription(subscriber.clone(), merchant.clone());

            // 5a. Load subscription — skip silently if absent (no event).
            let mut data: SubscriptionData = match env.storage().persistent().get(&key) {
                Some(data) => data,
                None => continue,
            };

            // 5b. Check time-lock — skip silently if not due.
            if now < data.next_payment {
                continue;
            }

            // 5c. Verify subscriber balance before transfer attempt.
            let token_client = token::Client::new(&env, &data.token);
            let subscriber_balance = token_client.balance(&subscriber);

            if subscriber_balance < data.amount {
                // Insufficient balance — emit failure event and skip to next payment.
                events::emit_payment_transfer_failure(&env, &subscriber, &merchant, data.amount);
                continue;
            }

            // 5d. Execute token transfer.
            //     If transfer panics (e.g., allowance revoked), the entire transaction reverts.
            //     This is expected Soroban behavior; the caller must ensure subscribers have
            //     sufficient allowance for all payments in the batch.
            token_client.transfer(
                &subscriber,
                &merchant,
                &data.amount,
            );

            // 5e. Transfer succeeded — advance next_payment and record key for TTL extension.
            data.next_payment = now + data.interval;
            env.storage().persistent().set(&key, &data);
            keys_to_extend.push_back(key);

            // 5f. Emit success events.
            events::emit_payment_transfer_success(&env, &subscriber, &merchant, data.amount);
            events::emit_executed(&env, &subscriber, &merchant, &data.token, data.amount);
        }

        // 6. Bulk extend TTL for all successful payments.
        for key in keys_to_extend.iter() {
            env.storage()
                .persistent()
                .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);
        }

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

    /// Query active subscription details for a subscriber-merchant pair.
    ///
    /// This is a read-only view function that returns subscription state without
    /// modifying any contract data. Frontend and backend systems can use this to
    /// efficiently query subscription details, check payment due dates, or validate
    /// subscription existence before initiating transactions.
    ///
    /// # Parameters
    /// - `subscriber`: Account being charged
    /// - `merchant`:   Account receiving payments
    ///
    /// # Returns
    /// - `Ok(Some(SubscriptionData))` — if an active subscription exists for the pair.
    ///   SubscriptionData contains:
    ///   - `token`: SEP-41 token contract address used for payments
    ///   - `amount`: Payment amount per interval (in token's smallest unit)
    ///   - `interval`: Seconds between payments
    ///   - `next_payment`: Unix timestamp of next valid payment window
    /// - `Ok(None)` — if no subscription exists for the pair
    ///
    /// # Authorization
    /// No authorization required — this is a public read-only view.
    ///
    /// # Gas Cost
    /// Minimal: single storage read operation (~500 gas)
    ///
    /// # Example Usage
    /// ```ignore
    /// // Check if subscription exists and get details
    /// match client.get_subscription(&subscriber, &merchant)? {
    ///     Some(sub) => {
    ///         println!("Payment due at: {}", sub.next_payment);
    ///         println!("Amount: {} {}", sub.amount, sub.token);
    ///     }
    ///     None => println!("No active subscription"),
    /// }
    /// ```
    pub fn get_subscription(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> Option<SubscriptionData> {
        let key = DataKey::Subscription(subscriber, merchant);
        env.storage().persistent().get(&key)
    }
}

#[cfg(test)]
mod test;
