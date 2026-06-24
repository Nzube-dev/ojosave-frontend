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
    /// - Propagated token contract errors      — if the transfer fails (insufficient allowance
    ///                                           or balance). SubscriptionData is NOT modified.
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

        // 4. Execute token transfer (subscriber → merchant).
        //    If this panics/errors, no state mutation below will execute.
        token::Client::new(&env, &data.token).transfer(
            &subscriber,
            &merchant,
            &data.amount,
        );

        // 5. Advance next_payment — using the `now` captured at invocation start.
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
    /// No event is emitted on cancellation (per Requirement 7.5).
    /// Off-chain indexers detect cancellation by the absence of future `executed` events.
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

        Ok(())
    }
}

#[cfg(test)]
mod test;
