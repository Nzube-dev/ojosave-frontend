use soroban_sdk::{Address, Env, Symbol};

/// Emit the `contract_deployed` event to signal contract availability and version to off-chain services.
///
/// This event should be emitted during initial deployment or can be retrieved for historical reference.
/// Topics:  (symbol("contract_deployed"))
/// Data:    version string (e.g., "1.0.0")
pub fn emit_contract_deployed(env: &Env, version: &str) {
    // Note: We emit the version as a simple string event for off-chain indexing
    env.events().publish(
        (Symbol::new(env, "contract_deployed"),),
        Symbol::new(env, version),
    );
}

/// Emit the `subscribe` event after a subscription has been successfully stored.
///
/// Topics:  (symbol("subscribe"), subscriber, merchant, token)
/// Data:    amount (i128)
pub fn emit_subscribe(env: &Env, subscriber: &Address, merchant: &Address, token: &Address, amount: i128) {
    env.events().publish(
        (
            Symbol::new(env, "subscribe"),
            subscriber.clone(),
            merchant.clone(),
            token.clone(),
        ),
        amount,
    );
}

/// Emit the `payment_transfer_success` event after a payment transfer has been successfully
/// completed and the next_payment timestamp has been updated.
///
/// This event provides dedicated telemetry for off-chain services to distinguish successful
/// payment collection attempts from failures, enabling improved backend reconciliation.
///
/// Topics:  (symbol("payment_transfer_success"), subscriber, merchant)
/// Data:    amount (i128)
pub fn emit_payment_transfer_success(env: &Env, subscriber: &Address, merchant: &Address, amount: i128) {
    env.events().publish(
        (
            Symbol::new(env, "payment_transfer_success"),
            subscriber.clone(),
            merchant.clone(),
        ),
        amount,
    );
}

/// Emit the `payment_transfer_failure` event when a payment transfer attempt fails.
///
/// This event is emitted when the token transfer does not go through, allowing off-chain
/// services to track failed collection attempts for reconciliation and retry logic.
///
/// Topics:  (symbol("payment_transfer_failure"), subscriber, merchant)
/// Data:    amount (i128)
pub fn emit_payment_transfer_failure(env: &Env, subscriber: &Address, merchant: &Address, amount: i128) {
    env.events().publish(
        (
            Symbol::new(env, "payment_transfer_failure"),
            subscriber.clone(),
            merchant.clone(),
        ),
        amount,
    );
}

/// Emit the `executed` event after a payment transfer has been successfully completed
/// and the next_payment timestamp has been updated.
///
/// Topics:  (symbol("executed"), subscriber, merchant, token)
/// Data:    amount (i128)
pub fn emit_executed(env: &Env, subscriber: &Address, merchant: &Address, token: &Address, amount: i128) {
    env.events().publish(
        (
            Symbol::new(env, "executed"),
            subscriber.clone(),
            merchant.clone(),
            token.clone(),
        ),
        amount,
    );
}

/// Emit the `cancel` event after a subscription has been successfully cancelled and removed.
///
/// Topics:  (symbol("cancel"), subscriber, merchant)
/// Data:    empty (unit type ())
pub fn emit_cancel(env: &Env, subscriber: &Address, merchant: &Address) {
    env.events().publish(
        (
            Symbol::new(env, "cancel"),
            subscriber.clone(),
            merchant.clone(),
        ),
        (),
    );
}

/// Emit the `batch_execute_initiated` event after batch payment execution starts.
///
/// This event provides telemetry for off-chain services to track batch execution operations.
///
/// Topics:  (symbol("batch_execute_initiated"), merchant)
/// Data:    batch_size (u32)
pub fn emit_batch_execute_initiated(env: &Env, merchant: &Address, batch_size: u32) {
    env.events().publish(
        (
            Symbol::new(env, "batch_execute_initiated"),
            merchant.clone(),
        ),
        batch_size as i128,
    );
}
