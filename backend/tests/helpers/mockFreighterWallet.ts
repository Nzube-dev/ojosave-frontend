/**
 * MockFreighterWallet.ts
 *
 * In-memory mock Freighter wallet for backend testing.
 * Supports keypair generation, transaction signing, and signature verification.
 * No browser extension or network required.
 */

import { Keypair, Transaction, Networks, TransactionBuilder } from '@stellar/stellar-sdk';

export interface WalletAccount {
  publicKey: string;
  secretKey: string;
  keypair: Keypair;
}

export interface SignedTxResult {
  success: boolean;
  xdr: string;
  error?: string;
}

export interface VerifyResult {
  valid: boolean;
  signer: string;
  error?: string;
}

export class MockFreighterWallet {
  private accounts: Map<string, WalletAccount> = new Map();
  private connectedKey: string | null = null;

  /**
   * Generate a new keypair and register it as an account in the wallet.
   * @returns The newly generated public key (G-address).
   */
  generateAccount(): string {
    const keypair = Keypair.random();
    const publicKey = keypair.publicKey();

    this.accounts.set(publicKey, {
      publicKey,
      secretKey: keypair.secret(),
      keypair,
    });

    return publicKey;
  }

  /**
   * Import an existing secret key as an account.
   * @param secretKey Stellar secret key.
   * @returns The associated public key.
   * @throws If the secret key is invalid.
   */
  importAccount(secretKey: string): string {
    const keypair = Keypair.fromSecret(secretKey);
    const publicKey = keypair.publicKey();

    this.accounts.set(publicKey, {
      publicKey,
      secretKey,
      keypair,
    });

    return publicKey;
  }

  /**
   * Simulate Freighter's requestAccess by connecting to a registered account.
   * @param publicKey The G-address to connect to (must exist in the wallet).
   * @throws If the account is not registered.
   */
  connect(publicKey: string): void {
    if (!this.accounts.has(publicKey)) {
      throw new Error(`Account ${publicKey} not registered in mock wallet`);
    }
    this.connectedKey = publicKey;
  }

  /**
   * Get the currently connected public key.
   * @returns The connected public key, or null if not connected.
   */
  getConnectedKey(): string | null {
    return this.connectedKey;
  }

  /**
   * Sign a transaction XDR using the currently connected account.
   * Simulates Freighter's signTransaction() call.
   * @param xdr Base-64 encoded unsigned transaction XDR.
   * @param networkPassphrase Stellar network passphrase.
   * @returns Signed transaction XDR.
   * @throws If no account is connected or if XDR is invalid.
   */
  signTransaction(xdr: string, networkPassphrase: string): SignedTxResult {
    if (!this.connectedKey) {
      return { success: false, xdr: '', error: 'No account connected' };
    }

    try {
      const account = this.accounts.get(this.connectedKey)!;
      const tx = new Transaction(xdr, networkPassphrase);
      tx.sign(account.keypair);
      return { success: true, xdr: tx.toEnvelope().toXDR('base64') };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, xdr: '', error: msg };
    }
  }

  /**
   * Verify that a transaction was signed by the given account.
   * @param xdr Signed transaction XDR.
   * @param publicKey Expected signer's public key.
   * @param networkPassphrase Stellar network passphrase.
   * @returns Verification result with signer information.
   */
  verifyTransaction(
    xdr: string,
    publicKey: string,
    networkPassphrase: string,
  ): VerifyResult {
    try {
      const tx = new Transaction(xdr, networkPassphrase);
      // Check if the transaction has any signatures
      if (!tx.signatures || tx.signatures.length === 0) {
        return { valid: false, signer: '', error: 'Transaction is not signed' };
      }

      // Verify using the expected public key
      const keypair = Keypair.fromPublicKey(publicKey);
      const hash = tx.hash();

      for (const sig of tx.signatures) {
        try {
          if (keypair.verify(hash, sig.signature())) {
            return { valid: true, signer: publicKey };
          }
        } catch {
          // Try next signature
        }
      }

      return { valid: false, signer: '', error: 'No valid signature from expected signer' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return { valid: false, signer: '', error: msg };
    }
  }

  /**
   * Get all registered accounts (for test setup).
   */
  getAccounts(): WalletAccount[] {
    return Array.from(this.accounts.values());
  }

  /**
   * Clear all accounts and disconnect (for test cleanup).
   */
  reset(): void {
    this.accounts.clear();
    this.connectedKey = null;
  }
}
