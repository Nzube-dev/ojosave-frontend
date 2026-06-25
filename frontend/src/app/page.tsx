'use client';

/**
 * page.tsx — Home page
 *
 * Renders the wallet connect/disconnect button and the subscription form.
 * Requirements: 9.1, 9.5, 9.6, 10.1
 */

import { useState } from 'react';
import SubscriptionForm from '@/components/SubscriptionForm';
import { useWallet } from '@/hooks/useWallet';

export default function Home() {
  const {
    publicKey,
    isConnecting,
    connectError,
    freighterInstalled,
    sessionInvalid,
    connect,
    disconnect,
  } = useWallet();

  const [copied, setCopied] = useState(false);

  const shortKey = publicKey
    ? `${publicKey.slice(0, 6)}…${publicKey.slice(-4)}`
    : null;

  async function copyKey() {
    if (!publicKey) return;
    await navigator.clipboard.writeText(publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-12">
      {/* Header */}
      <div className="w-full max-w-lg mb-8 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight mb-2">SorobanPay</h1>
        <p className="text-gray-400 text-sm">
          Decentralized recurring payments on Stellar
        </p>
      </div>

      {/* Wallet section */}
      <div className="w-full max-w-lg mb-6">
        {/* Session-invalid fallback — shown when Freighter is removed while connected */}
        {sessionInvalid && (
          <div
            role="alert"
            className="mb-4 rounded-lg bg-orange-900/60 border border-orange-600 p-4 text-sm text-orange-200"
          >
            <p className="font-semibold mb-1">Wallet session lost</p>
            <p className="text-xs mb-3">
              Freighter is no longer available. Disconnect and reconnect to restore your session.
            </p>
            <button
              onClick={disconnect}
              className="rounded-lg bg-orange-700 hover:bg-orange-600 px-4 py-2 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              Disconnect &amp; reconnect
            </button>
          </div>
        )}

        {!publicKey ? (
          <div className="bg-gray-900 rounded-2xl p-6 shadow-lg">
            {/* Req 9.1 — Freighter install prompt */}
            {!freighterInstalled && (
              <div
                role="alert"
                className="mb-4 rounded-lg bg-yellow-900/60 border border-yellow-600 p-3 text-sm text-yellow-200"
              >
                Freighter wallet is not installed.{' '}
                <a
                  href="https://www.freighter.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-yellow-100"
                >
                  Install Freighter
                </a>{' '}
                to continue.
              </div>
            )}

            {/* Req 9.4 — access denied error */}
            {connectError && (
              <div
                role="alert"
                className="mb-4 rounded-lg bg-red-900/60 border border-red-600 p-3 text-sm text-red-200"
              >
                {connectError}
              </div>
            )}

            <button
              onClick={connect}
              disabled={isConnecting}
              className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50
                         disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold
                         transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {isConnecting ? 'Connecting…' : 'Connect Freighter Wallet'}
            </button>
          </div>
        ) : (
          /* Connected: show full key with copy support + disconnect button */
          <div className="bg-gray-900 rounded-2xl p-4 shadow-lg flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-2 w-2 rounded-full bg-green-400 flex-shrink-0" aria-hidden="true" />
              <span className="text-sm text-gray-300 flex-shrink-0">Connected:</span>
              <button
                onClick={copyKey}
                title={publicKey}
                aria-label={`Copy full public key: ${publicKey}`}
                className="font-mono text-white text-sm truncate hover:text-blue-300 transition-colors focus:outline-none focus:ring-1 focus:ring-blue-400 rounded"
              >
                {shortKey}
              </button>
              <span
                aria-live="polite"
                className={`text-xs transition-opacity duration-300 flex-shrink-0 ${copied ? 'text-green-400 opacity-100' : 'opacity-0'}`}
              >
                Copied!
              </span>
            </div>
            {/* Req 9.6 — disconnect clears key */}
            <button
              onClick={disconnect}
              className="text-xs text-gray-400 hover:text-red-400 transition-colors flex-shrink-0
                         focus:outline-none focus:ring-1 focus:ring-red-400 rounded px-2 py-1"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {/* Subscription form — only rendered when wallet is connected (Req 9.5) */}
      {publicKey ? (
        <SubscriptionForm />
      ) : (
        <div className="w-full max-w-lg rounded-2xl border border-gray-800 bg-gray-900/40 p-8 text-center text-gray-500 text-sm">
          Connect your wallet above to create a subscription.
        </div>
      )}
    </main>
  );
}
