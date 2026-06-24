use soroban_sdk::contracterror;

/// Contract error codes — stable u32 values safe to return across invocation boundaries.
/// These are surfaced to callers via the Stellar RPC error response.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    /// `subscribe` called with amount <= 0
    AmountMustBePositive = 1,
    /// `subscribe` called with interval < 86400 seconds (1 day)
    IntervalTooShort     = 2,
    /// `subscribe` called with interval > 31536000 seconds (365 days)
    IntervalTooLong      = 3,
    /// `execute_payment` or `cancel` called with no active subscription for the pair
    NoActiveSubscription = 4,
    /// `execute_payment` called before next_payment timestamp has elapsed
    PaymentNotDue        = 5,
    /// Authorization check failed (supplementary; require_auth() panics directly)
    Unauthorized         = 6,
    /// `execute_payment` token transfer failed (insufficient balance or allowance)
    TransferFailed       = 7,
    /// `execute_payment_batch` called with empty payment list
    EmptyBatch           = 8,
    /// `execute_payment` called on a paused subscription
    SubscriptionPaused   = 9,
    /// `resume` called on an already-active (not paused) subscription
    SubscriptionNotPaused = 10,
}
