/**
 * wallet_manager.ts
 *
 * Freighter wallet integration layer.
 * All @stellar/freighter-api calls are isolated here.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */

import {
  isConnected,
  isAllowed,
  setAllowed,
  requestAccess,
  getAddress,
  signTransaction,
} from '@stellar/freighter-api';

// ─── Freighter detection ──────────────────────────────────────────────────────

/**
 * Returns true if the Freighter browser extension is installed and enabled.
 * Does NOT trigger any permission dialogs.
 */
export async function detectFreighter(): Promise<boolean> {
  try {
    const result = await isConnected();
    return result.isConnected === true;
  } catch {
    return false;
  }
}

// ─── Wallet connection ────────────────────────────────────────────────────────

/**
 * Request wallet access and return the connected Stellar public key (G-address).
 *
 * - Throws if Freighter is not installed (includes install URL in message).
 * - Throws if the user denies the access request.
 *
 * Only the key returned from the explicit requestAccess call in this session
 * is returned — never from cached credentials (Req 9.3).
 */
export async function connectWallet(): Promise<string> {
  const installed = await detectFreighter();
  if (!installed) {
    throw new Error(
      'Freighter wallet is not installed. ' +
        'Install it from https://www.freighter.app to continue.',
    );
  }

  // Grant site allowance if not already granted
  const allowed = await isAllowed();
  if (!allowed.isAllowed) {
    await setAllowed();
  }

  // Request explicit account access for this session
  const access = await requestAccess();
  if (access.error) {
    throw new Error(`Access was denied: ${access.error}`);
  }

  // Retrieve the public key from the current session response
  const keyResult = await getAddress();
  if (keyResult.error) {
    throw new Error(`Could not retrieve public key: ${keyResult.error}`);
  }
  if (!keyResult.address) {
    throw new Error('Freighter returned an empty public key.');
  }

  return keyResult.address;
}

// ─── Transaction signing ──────────────────────────────────────────────────────

/**
 * Sign a Stellar transaction XDR using the connected Freighter account.
 *
 * @param xdr              Base-64 encoded unsigned transaction XDR.
 * @param networkPassphrase Stellar network passphrase (testnet or mainnet).
 * @returns Signed transaction XDR as a base-64 string.
 * @throws  If Freighter returns an error or the user rejects the request.
 */
export async function signTx(
  xdr: string,
  networkPassphrase: string,
): Promise<string> {
  const result = await signTransaction(xdr, { networkPassphrase });

  if ('error' in result && result.error) {
    throw new Error(`Transaction signing failed: ${result.error}`);
  }

  const signed = (result as { signedTxXdr: string }).signedTxXdr;
  if (!signed) {
    throw new Error('Freighter returned an empty signed transaction XDR.');
  }

  return signed;
}
