use soroban_sdk::{Address, Env, Symbol};

/// Emit the `subscribe` event after a subscription has been successfully stored.
///
/// Topics:  (symbol("subscribe"), subscriber, merchant)
/// Data:    amount (i128)
pub fn emit_subscribe(env: &Env, subscriber: &Address, merchant: &Address, amount: i128) {
    env.events().publish(
        (
            Symbol::new(env, "subscribe"),
            subscriber.clone(),
            merchant.clone(),
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
/// **Deprecated:** Use `emit_payment_transfer_success` instead for clearer telemetry.
/// This event is maintained for backwards compatibility.
///
/// Topics:  (symbol("executed"), subscriber, merchant)
/// Data:    amount (i128)
pub fn emit_executed(env: &Env, subscriber: &Address, merchant: &Address, amount: i128) {
    env.events().publish(
        (
            Symbol::new(env, "executed"),
            subscriber.clone(),
            merchant.clone(),
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
