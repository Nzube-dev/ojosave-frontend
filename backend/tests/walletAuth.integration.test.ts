/**
 * walletAuth.integration.test.ts
 *
 * Integration tests for MockFreighterWallet and wallet auth workflows.
 */

import { MockFreighterWallet } from '../helpers/mockFreighterWallet';
import { Keypair } from '@stellar/stellar-sdk';
import {
  KEYPAIR_ALICE,
  KEYPAIR_BOB,
  ALICE,
  BOB,
  SECRET_ALICE,
  SECRET_BOB,
  TX_ALICE_TO_BOB,
  UNSIGNED_TX_ALICE,
  INVALID_XDR,
  NETWORK_TESTNET,
} from '../helpers/walletFixtures';

let wallet: MockFreighterWallet;

beforeEach(() => {
  wallet = new MockFreighterWallet();
});

describe('Account management', () => {
  it('generates a new account with a unique keypair', () => {
    const key1 = wallet.generateAccount();
    const key2 = wallet.generateAccount();

    expect(key1).not.toBe(key2);
    expect(key1).toMatch(/^G[A-Z0-9]{55}$/); // Stellar public key format
  });

  it('imports an existing secret key', () => {
    const publicKey = wallet.importAccount(SECRET_ALICE);
    expect(publicKey).toBe(ALICE);
  });

  it('rejects an invalid secret key', () => {
    expect(() => wallet.importAccount('INVALID')).toThrow();
  });

  it('tracks multiple registered accounts', () => {
    wallet.importAccount(SECRET_ALICE);
    wallet.importAccount(SECRET_BOB);

    const accounts = wallet.getAccounts();
    expect(accounts).toHaveLength(2);
    expect(accounts.map((a: any) => a.publicKey)).toContain(ALICE);
    expect(accounts.map((a: any) => a.publicKey)).toContain(BOB);
  });
});

describe('Account connection', () => {
  beforeEach(() => {
    wallet.importAccount(SECRET_ALICE);
    wallet.importAccount(SECRET_BOB);
  });

  it('connects to a registered account', () => {
    wallet.connect(ALICE);
    expect(wallet.getConnectedKey()).toBe(ALICE);
  });

  it('throws when connecting to an unknown account', () => {
    const unknownKey = Keypair.random().publicKey();
    expect(() => wallet.connect(unknownKey)).toThrow();
  });

  it('can switch between connected accounts', () => {
    wallet.connect(ALICE);
    expect(wallet.getConnectedKey()).toBe(ALICE);

    wallet.connect(BOB);
    expect(wallet.getConnectedKey()).toBe(BOB);
  });

  it('starts disconnected', () => {
    expect(wallet.getConnectedKey()).toBeNull();
  });
});

describe('Transaction signing', () => {
  beforeEach(() => {
    wallet.importAccount(SECRET_ALICE);
    wallet.connect(ALICE);
  });

  it('signs a transaction with the connected account', () => {
    const result = wallet.signTransaction(UNSIGNED_TX_ALICE, NETWORK_TESTNET);

    expect(result.success).toBe(true);
    expect(result.xdr).toBeTruthy();
    expect(result.error).toBeUndefined();
  });

  it('returns an error when no account is connected', () => {
    wallet = new MockFreighterWallet();

    const result = wallet.signTransaction(UNSIGNED_TX_ALICE, NETWORK_TESTNET);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no account connected/i);
  });

  it('returns an error for invalid XDR', () => {
    const result = wallet.signTransaction(INVALID_XDR, NETWORK_TESTNET);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('Transaction verification', () => {
  beforeEach(() => {
    wallet.importAccount(SECRET_ALICE);
  });

  it('verifies a signature by the expected signer', () => {
    const result = wallet.verifyTransaction(TX_ALICE_TO_BOB, ALICE, NETWORK_TESTNET);

    expect(result.valid).toBe(true);
    expect(result.signer).toBe(ALICE);
  });

  it('rejects a transaction signed by a different account', () => {
    wallet.importAccount(SECRET_BOB);
    const result = wallet.verifyTransaction(TX_ALICE_TO_BOB, BOB, NETWORK_TESTNET);

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/no valid signature/i);
  });

  it('rejects an unsigned transaction', () => {
    const result = wallet.verifyTransaction(UNSIGNED_TX_ALICE, ALICE, NETWORK_TESTNET);

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not signed/i);
  });

  it('rejects invalid XDR', () => {
    const result = wallet.verifyTransaction(INVALID_XDR, ALICE, NETWORK_TESTNET);

    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('Reset and cleanup', () => {
  it('clears all accounts and disconnects', () => {
    wallet.generateAccount();
    wallet.importAccount(SECRET_ALICE);
    wallet.connect(ALICE);

    wallet.reset();

    expect(wallet.getConnectedKey()).toBeNull();
    expect(wallet.getAccounts()).toHaveLength(0);
  });
});
