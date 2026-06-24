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
    /// Token transfer failed — subscriber lacks sufficient allowance.
    /// The contract has attempted to transfer tokens but the subscriber's
    /// approval to the contract is less than the payment amount.
    /// Action: subscriber should increase allowance via token.approve()
    InsufficientAllowance = 7,
    /// Token transfer failed — subscriber lacks sufficient balance.
    /// The subscriber's token balance is less than the payment amount.
    /// Action: subscriber should acquire more tokens before retry
    InsufficientBalance = 8,
    /// Token transfer failed — authorization check failed on token contract.
    /// The token contract rejected the transfer for permission/auth reasons
    /// beyond standard balance/allowance checks (e.g., frozen account, paused token).
    /// Action: check token contract state and permissions
    TokenAuthorizationFailed = 9,
    /// Token transfer panicked with unknown error.
    /// The underlying token contract encountered an error that does not map
    /// to standard allowance or balance issues. Check logs for details.
    TokenTransferFailed = 10,
}
