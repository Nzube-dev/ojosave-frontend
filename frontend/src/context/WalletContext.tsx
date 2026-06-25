'use client';

/**
 * WalletContext.tsx
 *
 * React context for Freighter wallet state.
 * Wrap the app in <WalletProvider> to make wallet state available
 * to all child components via useWallet().
 *
 * Requirements: 9.1–9.6
 */

import React, {
  createContext,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import { connectWallet, detectFreighter } from '@/lib/wallet_manager';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletContextValue {
  /** Connected account public key, or null when disconnected. */
  publicKey: string | null;
  /** True while a connect request is in flight. */
  isConnecting: boolean;
  /** Error message from the last failed connect attempt. */
  connectError: string | null;
  /** True when Freighter extension is detected in the browser. */
  freighterInstalled: boolean;
  /** True when a previously-connected session has become invalid (Freighter unavailable). */
  sessionInvalid: boolean;
  /** Trigger wallet connection — opens Freighter permission dialog. */
  connect: () => Promise<void>;
  /** Clear publicKey and return to disconnected state. */
  disconnect: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const WalletContext = createContext<WalletContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [freighterInstalled, setFreighterInstalled] = useState(true);
  const [sessionInvalid, setSessionInvalid] = useState(false);

  // Poll for Freighter availability every 10 s when a session is active.
  // If Freighter disappears, mark session invalid so the UI can show a fallback.
  useEffect(() => {
    if (!publicKey) {
      setSessionInvalid(false);
      return;
    }
    const id = setInterval(async () => {
      const ok = await detectFreighter();
      if (!ok) setSessionInvalid(true);
    }, 10_000);
    return () => clearInterval(id);
  }, [publicKey]);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setConnectError(null);
    setSessionInvalid(false);

    try {
      // Check installation first so we can show the install link (Req 9.1)
      const installed = await detectFreighter();
      setFreighterInstalled(installed);

      if (!installed) {
        setConnectError(
          'Freighter is not installed. Install it from https://www.freighter.app',
        );
        return;
      }

      // Request explicit access — stores ONLY the key from this session (Req 9.3)
      const key = await connectWallet();
      setPublicKey(key);
    } catch (err) {
      // User denied access or another Freighter error (Req 9.4)
      const msg = err instanceof Error ? err.message : 'Wallet connection failed.';
      setConnectError(msg);
      setPublicKey(null); // Return to disconnected state (Req 9.4)
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null);     // Clears stored key (Req 9.6)
    setConnectError(null);
    setSessionInvalid(false);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        publicKey,
        isConnecting,
        connectError,
        freighterInstalled,
        sessionInvalid,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
