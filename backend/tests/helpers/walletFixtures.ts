/**
 * walletFixtures.ts
 *
 * Pre-generated keypairs and test transactions for use in backend tests.
 * Deterministic — use for consistent test snapshots and cross-test references.
 */

import {
  Keypair,
  TransactionBuilder,
  Operation,
  BASE_FEE,
  Account,
  Asset,
} from '@stellar/stellar-sdk';

// ── Deterministic test keypairs ────────────────────────────────────────────────
// Generated with a fixed seed to ensure reproducibility across test runs.

const SEED_ALICE = Buffer.from('alice'.padEnd(32, '0'));
const SEED_BOB   = Buffer.from('bob'.padEnd(32, '0'));
const SEED_MERCHANT = Buffer.from('merchant'.padEnd(32, '0'));

export const KEYPAIR_ALICE = Keypair.fromRawEd25519Seed(SEED_ALICE);
export const KEYPAIR_BOB = Keypair.fromRawEd25519Seed(SEED_BOB);
export const KEYPAIR_MERCHANT = Keypair.fromRawEd25519Seed(SEED_MERCHANT);

export const ALICE = KEYPAIR_ALICE.publicKey();
export const BOB = KEYPAIR_BOB.publicKey();
export const MERCHANT = KEYPAIR_MERCHANT.publicKey();

export const SECRET_ALICE = KEYPAIR_ALICE.secret();
export const SECRET_BOB = KEYPAIR_BOB.secret();
export const SECRET_MERCHANT = KEYPAIR_MERCHANT.secret();

// ── Prebuilt test transactions ─────────────────────────────────────────────────

/**
 * Build a signed test transaction suitable for backend verification.
 */
export function buildSignedTx(
  signer: Keypair,
  destination: string,
  amount: string = '100',
  networkPassphrase: string = 'Test SDF Network ; September 2015',
): string {
  const source = new Account(signer.publicKey(), '0');
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount,
      }),
    )
    .setTimeout(300)
    .build();

  tx.sign(signer);
  return tx.toEnvelope().toXDR('base64');
}

/** Alice sends 100 XLM to Bob (signed by Alice). */
export const TX_ALICE_TO_BOB = buildSignedTx(KEYPAIR_ALICE, BOB);

/** Bob sends 50 XLM to Merchant (signed by Bob). */
export const TX_BOB_TO_MERCHANT = buildSignedTx(KEYPAIR_BOB, MERCHANT, '50');

/** Merchant sends 10 XLM to Alice (signed by Merchant). */
export const TX_MERCHANT_TO_ALICE = buildSignedTx(KEYPAIR_MERCHANT, ALICE, '10');

/**
 * Unsigned transaction for testing signing workflows.
 */
export function buildUnsignedTx(
  source: Keypair,
  destination: string,
  networkPassphrase: string = 'Test SDF Network ; September 2015',
): string {
  const account = new Account(source.publicKey(), '0');
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount: '100',
      }),
    )
    .setTimeout(300)
    .build();

  return tx.toEnvelope().toXDR('base64');
}

export const UNSIGNED_TX_ALICE = buildUnsignedTx(KEYPAIR_ALICE, BOB);

// ── Malformed test cases ───────────────────────────────────────────────────────

export const INVALID_XDR = 'not-a-valid-xdr-string';
export const MALFORMED_XDR = Buffer.from('garbage').toString('base64');

// ── Network passphrases ────────────────────────────────────────────────────────

export const NETWORK_TESTNET = 'Test SDF Network ; September 2015';
export const NETWORK_MAINNET = 'Public Global Stellar Network ; September 2015';
