use soroban_sdk::{contracttype, Address};

// ==================== Version Metadata ====================
/// Contract semantic version: MAJOR.MINOR.PATCH
/// Increment MAJOR for breaking changes, MINOR for new backwards-compatible features, PATCH for bug fixes
pub const CONTRACT_VERSION: &str = "1.0.0";

/// Contract version as numeric components for off-chain compatibility checks
pub const VERSION_MAJOR: u32 = 1;
pub const VERSION_MINOR: u32 = 0;
pub const VERSION_PATCH: u32 = 0;

/// Human-readable contract identifier for integration verification
pub const CONTRACT_NAME: &str = "SorobanPay-SubscriptionProtocol";

// ==================== Storage & Data Structures ====================

/// Composite storage key uniquely identifying a subscription.
/// One entry per (subscriber, merchant) pair.
#[contracttype]
pub enum DataKey {
    Subscription(Address, Address),
}

/// Persistent on-chain record for a subscription.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubscriptionData {
    pub token:        Address,   // SEP-41 token contract address
    pub amount:       i128,      // payment amount per interval (strictly positive)
    pub interval:     u64,       // seconds between payments [86400, 31536000]
    pub next_payment: u64,       // Unix timestamp of next valid payment window
    pub is_paused:    bool,      // true if subscription payments are suspended
}

/// Safe upper bound for a single subscription payment amount (1 × 10¹⁸ stroops).
///
/// Stellar Asset Contract (SAC) balances are represented as i64 internally, so
/// the theoretical maximum is i64::MAX ≈ 9.2 × 10¹⁸.  We cap at 1 × 10¹⁸ to:
///   - stay comfortably below i64::MAX and avoid edge-case overflow in downstream
///     arithmetic (e.g. fee calculations, multi-hop aggregations);
///   - prevent accidental fat-finger amounts that would drain a subscriber in a
///     single interval;
///   - keep the value human-readable (10¹² XLM at 10⁶ stroops/XLM — far beyond
///     any realistic subscription use-case).
pub const MAX_AMOUNT: i128 = 1_000_000_000_000_000_000; // 1e18 stroops

/// ~30 days at 5-second ledger close time (518_400 ledgers)
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;

/// ~365 days at 5-second ledger close time (6_307_200 ledgers)
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;
