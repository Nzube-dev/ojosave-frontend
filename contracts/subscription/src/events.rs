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

/// Emit the `executed` event after a payment transfer has been successfully completed
/// and the next_payment timestamp has been updated.
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
