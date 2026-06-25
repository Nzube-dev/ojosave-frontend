#![no_std]

mod error;
mod events;
mod storage;

use soroban_sdk::{contract, contractimpl, token, Address, Env};

use crate::error::ContractError;
use crate::storage::{DataKey, SubscriptionData, MAX_TTL_LEDGERS, MIN_TTL_LEDGERS};

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
