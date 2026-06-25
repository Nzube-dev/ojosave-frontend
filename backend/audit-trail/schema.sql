CREATE TABLE subscription_cancellations (
    id UUID PRIMARY KEY,
    network TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    subscriber_address TEXT NOT NULL,
    merchant_address TEXT NOT NULL,
    token_address TEXT,
    amount TEXT,
    interval_seconds BIGINT,
    next_payment_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ledger BIGINT NOT NULL,
    transaction_hash TEXT NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT subscription_cancellations_network_known
        CHECK (network IN ('testnet', 'mainnet')),
    CONSTRAINT subscription_cancellations_reason_length
        CHECK (reason IS NULL OR char_length(reason) <= 1000),
    CONSTRAINT subscription_cancellations_interval_positive
        CHECK (interval_seconds IS NULL OR interval_seconds > 0),
    CONSTRAINT subscription_cancellations_amount_numeric_text
        CHECK (amount IS NULL OR amount ~ '^[0-9]+$')
);

CREATE UNIQUE INDEX subscription_cancellations_network_tx_hash_idx
    ON subscription_cancellations (network, transaction_hash);

CREATE INDEX subscription_cancellations_merchant_cancelled_at_idx
    ON subscription_cancellations (merchant_address, cancelled_at DESC);

CREATE INDEX subscription_cancellations_subscriber_cancelled_at_idx
    ON subscription_cancellations (subscriber_address, cancelled_at DESC);

CREATE INDEX subscription_cancellations_contract_pair_idx
    ON subscription_cancellations (
        network,
        contract_id,
        subscriber_address,
        merchant_address
    );
