'use client';

/**
 * SubscriptionForm.tsx
 *
 * Full subscription creation form with inline validation,
 * loading state, success and error notifications.
 *
 * Requirements: 10.1–10.9
 * Improvements:
 *  - Mobile spacing & touch targets (min 44px, larger padding)
 *  - Enhanced success state with next-steps guidance
 *  - Progress indicator (animated bar) during async transaction
 *  - Contract config error card with remediation steps
 */

import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { buildAndSubmitSubscribe } from '@/lib/transaction_builder';
import {
  validateSubscriptionForm,
  isFormValid,
  DEFAULT_INTERVAL_SECONDS,
  type FieldErrors,
} from '@/lib/validation';
import { CONTRACT_ID, NETWORK_PASSPHRASE, NETWORK_NAME, RPC_URL } from '@/constants/network';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SuccessData {
  txHash: string;
  merchant: string;
  token: string;
  amount: string;
  interval: string;
}

// ─── Shared input className (larger py for ≥48px touch target on mobile) ─────
const inputCls =
  'w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 text-base ' +
  'text-white placeholder-gray-500 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ' +
  'disabled:opacity-50 min-h-[48px] transition-all duration-150';

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Copied!' : `${label} to clipboard`}
      title={copied ? 'Copied!' : `${label} to clipboard`}
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium
                 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-gray-300
                 hover:text-white transition-colors duration-150 shrink-0
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
    >
      {copied ? (
        <>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-green-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <span className="text-green-400">Copied!</span>
        </>
      ) : (
        <>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
            <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

// ─── Network + contract status badge ──────────────────────────────────────────

type ReachStatus = 'checking' | 'reachable' | 'unreachable';

function NetworkBadge() {
  const [status, setStatus] = useState<ReachStatus>('checking');

  useEffect(() => {
    let cancelled = false;
    fetch(RPC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(() => { if (!cancelled) setStatus('reachable'); })
      .catch(() => { if (!cancelled) setStatus('unreachable'); });
    return () => { cancelled = true; };
  }, []);

  const networkColor = NETWORK_NAME === 'Mainnet'
    ? 'bg-purple-900/50 border-purple-600/50 text-purple-300'
    : 'bg-blue-900/50 border-blue-600/50 text-blue-300';

  const statusDot: Record<ReachStatus, string> = {
    checking:    'bg-yellow-400 animate-pulse',
    reachable:   'bg-green-400',
    unreachable: 'bg-red-400',
  };
  const statusLabel: Record<ReachStatus, string> = {
    checking:    'Checking…',
    reachable:   'Contract reachable',
    unreachable: 'RPC unreachable',
  };

  return (
    <div
      aria-label={`Network: ${NETWORK_NAME}. Status: ${statusLabel[status]}`}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${networkColor}`}
    >
      <span aria-hidden="true">{NETWORK_NAME === 'Mainnet' ? '🌐' : '🧪'}</span>
      {NETWORK_NAME}
      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${statusDot[status]}`} aria-hidden="true" />
      <span className="text-xs font-normal opacity-80">{statusLabel[status]}</span>
    </div>
  );
}

// ─── Contract config guard ─────────────────────────────────────────────────────

function ContractConfigError() {
  return (
    <div className="w-full max-w-lg mx-auto p-4 sm:p-6">
      <div
        role="alert"
        className="w-full rounded-2xl bg-gradient-to-br from-yellow-900/40 to-yellow-800/20 border-2 border-yellow-600/50 shadow-lg p-6 sm:p-8 text-white"
      >
        <div className="flex items-start gap-4 mb-6">
          <span className="text-4xl flex-shrink-0" aria-hidden="true">⚠️</span>
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-yellow-300 mb-2">Contract not configured</h2>
            <p className="text-gray-300 text-sm leading-relaxed">
              The app cannot find a valid Soroban contract address. This is an
              environment setup issue, not a wallet problem.
            </p>
          </div>
        </div>

        <div className="bg-gray-900/60 rounded-lg p-4 sm:p-6 mb-6">
          <h3 className="text-yellow-300 font-semibold text-base mb-4">Remediation steps:</h3>
          <ol className="list-decimal list-inside space-y-3 text-sm text-gray-300">
            <li className="leading-relaxed">
              Deploy the contract:
              <pre className="mt-2 bg-gray-800 rounded-lg p-3 text-xs overflow-x-auto border border-gray-700">
                <code>bash deploy/deploy.sh</code>
              </pre>
            </li>
            <li className="leading-relaxed">
              Copy the printed address into{' '}
              <code className="bg-gray-800 px-2 py-1 rounded text-yellow-300 text-xs font-mono">frontend/.env.local</code>:
              <div className="mt-2 flex items-center gap-2">
                <pre className="flex-1 bg-gray-800 rounded-lg p-3 text-xs overflow-x-auto border border-gray-700">
                  <code>NEXT_PUBLIC_CONTRACT_ID=C…your_address…</code>
                </pre>
                <CopyButton text="NEXT_PUBLIC_CONTRACT_ID=C…your_address…" label="Copy" />
              </div>
            </li>
            <li className="leading-relaxed">
              Restart the dev server:
              <pre className="mt-2 bg-gray-800 rounded-lg p-3 text-xs overflow-x-auto border border-gray-700">
                <code>npm run dev</code>
              </pre>
            </li>
          </ol>
        </div>

        <div className="border-t border-yellow-600/30 pt-4">
          <p className="text-xs text-gray-300">
            📖 For full details, see <code className="bg-gray-800/60 px-1.5 py-0.5 rounded text-yellow-300">README.md → Frontend → Environment variables</code>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar() {
  return (
    <div className="w-full mb-6 p-4 sm:p-5 bg-blue-900/20 border border-blue-600/40 rounded-lg" role="status" aria-label="Transaction in progress">
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <svg className="animate-spin h-5 w-5 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span className="text-sm font-medium text-blue-300">Submitting transaction…</span>
        </div>
        <span className="text-xs text-blue-200 animate-pulse">Processing on blockchain</span>
      </div>
      <div className="h-2 w-full bg-gray-700 rounded-full overflow-hidden shadow-inner">
        <div className="h-full bg-gradient-to-r from-blue-400 via-blue-500 to-blue-400 rounded-full animate-progress" />
      </div>
      <p className="mt-2 text-xs text-gray-300 text-center">
        This may take 10-30 seconds. Keep the window open.
      </p>
    </div>
  );
}

// ─── Success card ──────────────────────────────────────────────────────────────

function SuccessCard({
  data,
  onReset,
}: {
  data: SuccessData;
  onReset: () => void;
}) {
  const days = Math.round(Number(data.interval) / 86400);
  return (
    <div
      role="alert"
      className="mb-6 rounded-xl bg-gradient-to-br from-green-900/60 to-green-800/30 border-2 border-green-600/60 p-5 sm:p-6 text-sm space-y-4 shadow-lg"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-2xl flex-shrink-0" aria-hidden="true">✓</span>
        <p className="font-semibold text-green-300 text-base sm:text-lg">Subscription created successfully!</p>
      </div>

      {/* Tx hash */}
      <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
        <p className="text-gray-400 text-xs mb-1.5 font-medium">Transaction hash</p>
        <p className="text-gray-200 break-all font-mono text-xs leading-relaxed">{data.txHash}</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs text-gray-300 bg-gray-800/30 rounded-lg p-3">
        <span className="text-gray-300 font-medium">Amount</span>
        <span className="font-medium">{data.amount} tokens</span>
        <span className="text-gray-300 font-medium">Interval</span>
        <span className="font-medium">every {days} day{days !== 1 ? 's' : ''}</span>
        <span className="text-gray-300 font-medium break-all">Merchant</span>
        <span className="break-all font-mono text-xs">{data.merchant}</span>
      </div>

      {/* Next steps */}
      <div className="border-t border-green-800/60 pt-4 space-y-2.5">
        <p className="text-green-300 font-semibold text-xs uppercase tracking-widest">What happens next</p>
        <ul className="list-disc list-inside space-y-2 text-gray-300 text-xs leading-relaxed">
          <li>The merchant can collect the first payment immediately.</li>
          <li>Subsequent payments are collectible every {days} day{days !== 1 ? 's' : ''}.</li>
          <li>
            To cancel, call{' '}
            <code className="bg-gray-800 px-1.5 py-0.5 rounded text-green-300 text-xs">cancel(subscriber, merchant)</code>{' '}
            on the contract, or revoke the token allowance via your wallet.
          </li>
          <li>Your wallet remains non-custodial — the contract never holds your funds.</li>
        </ul>
      </div>

      <button
        onClick={onReset}
        className="w-full rounded-lg border-2 border-green-600/70 text-green-300 hover:bg-green-900/40 active:bg-green-900/60
                   py-3 text-sm font-semibold transition-all duration-150 min-h-[48px] hover:shadow-lg
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
      >
        Create Another Subscription
      </button>
    </div>
  );
}

// ─── Confirmation modal ────────────────────────────────────────────────────────

function ConfirmModal({
  merchantAddress,
  tokenAddress,
  amount,
  interval,
  onConfirm,
  onCancel,
}: {
  merchantAddress: string;
  tokenAddress: string;
  amount: string;
  interval: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const days = Math.round(Number(interval) / 86400);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 space-y-5 text-white">
        <h3 id="confirm-title" className="text-lg font-bold">Confirm subscription</h3>
        <p className="text-sm text-gray-400">Review the details before authorizing the on-chain transaction.</p>

        <dl className="bg-gray-800/60 rounded-lg divide-y divide-gray-700 text-sm">
          {[
            ['Merchant',  merchantAddress],
            ['Token',     tokenAddress],
            ['Amount',    `${amount} tokens`],
            ['Interval',  `${days} day${days !== 1 ? 's' : ''} (${interval} s)`],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 px-4 py-3">
              <dt className="text-xs text-gray-400 font-medium">{label}</dt>
              <dd className="break-all font-mono text-xs text-gray-100">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-600 bg-gray-800/50 text-gray-300 hover:bg-gray-700 active:bg-gray-800 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
          >
            Go Back
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            Confirm & Authorize
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Transaction error classifier + card ──────────────────────────────────────

interface TxErrorInfo {
  title: string;
  summary: string;
  fix: string;
  raw: string;
}

function classifyError(err: unknown): TxErrorInfo {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toLowerCase();

  if (msg.includes('user declined') || msg.includes('rejected') || msg.includes('signing failed') || msg.includes('user rejected')) {
    return {
      title:   'Signing cancelled',
      summary: 'You declined the transaction in Freighter.',
      fix:     'Click "Authorize Subscription" again and approve the request in the Freighter pop-up.',
      raw,
    };
  }
  if (msg.includes('insufficient balance') || msg.includes('not enough') || msg.includes('underfunded')) {
    return {
      title:   'Insufficient balance',
      summary: 'Your wallet does not have enough tokens or XLM to cover this transaction.',
      fix:     'Top up your account. On testnet use Stellar Friendbot; on mainnet send XLM to your address.',
      raw,
    };
  }
  if (msg.includes('allowance') || msg.includes('transfer from') || msg.includes('spend limit')) {
    return {
      title:   'Token allowance too low',
      summary: 'The contract is not authorized to transfer this token amount on your behalf.',
      fix:     'Approve a higher token allowance by calling token.approve(contract_id, amount) before subscribing.',
      raw,
    };
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return {
      title:   'Transaction timed out',
      summary: 'The network did not confirm the transaction within the expected time.',
      fix:     'Check your connection and retry. The transaction may still confirm — wait a minute before resubmitting.',
      raw,
    };
  }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('rpc') || msg.includes('failed to fetch')) {
    return {
      title:   'Network error',
      summary: 'Could not reach the Soroban RPC endpoint.',
      fix:     'Check your internet connection and verify NEXT_PUBLIC_RPC_URL in .env.local. Retry in a moment.',
      raw,
    };
  }
  if (msg.includes('wrong network') || msg.includes('passphrase') || msg.includes('network mismatch')) {
    return {
      title:   'Wrong network',
      summary: 'Freighter is set to a different network than the app expects.',
      fix:     `Open Freighter, switch to ${NETWORK_NAME}, and try again.`,
      raw,
    };
  }
  if (msg.includes('amountmustbepositive') || msg.includes('error(contract, #1)')) {
    return {
      title:   'Invalid amount',
      summary: 'The contract rejected the amount — it must be greater than zero.',
      fix:     'Enter a positive integer amount and resubmit.',
      raw,
    };
  }
  if (msg.includes('intervaltoo') || msg.includes('error(contract, #2)') || msg.includes('error(contract, #3)')) {
    return {
      title:   'Invalid interval',
      summary: 'The payment interval is outside the allowed range (1 day – 1 year).',
      fix:     'Enter a value between 86 400 s (1 day) and 31 536 000 s (1 year).',
      raw,
    };
  }
  if (msg.includes('unauthorized') || msg.includes('error(contract, #6)')) {
    return {
      title:   'Authorisation failed',
      summary: 'The contract rejected the transaction signature.',
      fix:     'Ensure the connected wallet matches the subscriber address and retry.',
      raw,
    };
  }

  return {
    title:   'Transaction failed',
    summary: 'An unexpected error occurred while submitting the transaction.',
    fix:     'Review the technical details below and retry. If the problem persists, check the README troubleshooting section.',
    raw,
  };
}

function ErrorCard({ error, onDismiss }: { error: TxErrorInfo; onDismiss: () => void }) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div
      role="alert"
      className="mb-6 rounded-xl bg-red-900/40 border border-red-600/70 p-4 sm:p-5 text-sm shadow-md"
    >
      <div className="flex items-start gap-3 mb-3">
        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">⚠</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-red-300 text-base leading-snug">{error.title}</p>
          <p className="mt-1 text-gray-300 leading-relaxed">{error.summary}</p>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="shrink-0 text-gray-500 hover:text-gray-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Suggested fix */}
      <div className="flex items-start gap-2 bg-gray-800/60 rounded-lg px-3 py-2.5 mb-3">
        <span className="text-blue-400 shrink-0 mt-0.5" aria-hidden="true">→</span>
        <p className="text-gray-200 text-xs leading-relaxed">{error.fix}</p>
      </div>

      {/* Collapsible technical details */}
      <button
        type="button"
        onClick={() => setShowDetails(v => !v)}
        aria-expanded={showDetails}
        className="text-xs text-gray-500 hover:text-gray-300 transition-colors underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded"
      >
        {showDetails ? 'Hide' : 'Show'} technical details
      </button>
      {showDetails && (
        <div className="mt-2 flex items-start gap-2 bg-gray-900/70 rounded-lg p-3 border border-gray-700">
          <pre className="flex-1 text-xs text-gray-400 font-mono whitespace-pre-wrap break-all leading-relaxed overflow-x-auto">
            {error.raw}
          </pre>
          <CopyButton text={error.raw} label="Copy" />
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SubscriptionForm() {
  // Guard: must have a valid contract address before rendering the form
  if (!CONTRACT_ID) return <ContractConfigError />;

  const { publicKey } = useWallet();

  const [merchantAddress, setMerchantAddress] = useState('');
  const [tokenAddress, setTokenAddress]       = useState('');
  const [amount, setAmount]                   = useState('');
  const [interval, setInterval]               = useState(String(DEFAULT_INTERVAL_SECONDS));

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors]   = useState<FieldErrors>({});
  const [txError, setTxError]           = useState<TxErrorInfo | null>(null);
  const [successData, setSuccessData]   = useState<SuccessData | null>(null);
  const [showConfirm, setShowConfirm]   = useState(false);

  function resetForm() {
    setSuccessData(null);
    setTxError(null);
    setFieldErrors({});
    setShowConfirm(false);
    setMerchantAddress('');
    setTokenAddress('');
    setAmount('');
    setInterval(String(DEFAULT_INTERVAL_SECONDS));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTxError(null);
    setSuccessData(null);

    const errors = validateSubscriptionForm({ merchantAddress, tokenAddress, amount, interval });
    setFieldErrors(errors);
    if (!isFormValid(errors)) return;
    if (!publicKey) return;

    setShowConfirm(true);
  }

  async function confirmAndSubmit() {
    setShowConfirm(false);
    if (!publicKey) return;

    setIsSubmitting(true);
    try {
      const result = await buildAndSubmitSubscribe(
        {
          subscriber: publicKey,
          merchant:   merchantAddress.trim(),
          token:      tokenAddress.trim(),
          amount:     Number(amount),
          interval:   Number(interval),
        },
        CONTRACT_ID,
        publicKey,
        NETWORK_PASSPHRASE,
        RPC_URL,
      );

      setSuccessData({
        txHash:   result.txHash,
        merchant: merchantAddress.trim(),
        token:    tokenAddress.trim(),
        amount,
        interval,
      });
    } catch (err) {
      setTxError(classifyError(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-lg mx-auto bg-gray-900 rounded-2xl shadow-xl p-5 sm:p-8 text-white">
      {showConfirm && (
        <ConfirmModal
          merchantAddress={merchantAddress}
          tokenAddress={tokenAddress}
          amount={amount}
          interval={interval}
          onConfirm={confirmAndSubmit}
          onCancel={() => setShowConfirm(false)}
        />
      )}
      <div className="flex items-center justify-between mb-2 gap-3">
        <h2 className="text-2xl sm:text-3xl font-bold">Create Subscription</h2>
        <span
          aria-label={publicKey ? 'Wallet connected' : 'Wallet disconnected'}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shrink-0 ${
            publicKey
              ? 'bg-green-900/60 text-green-300 border border-green-600/50'
              : 'bg-gray-700/60 text-gray-400 border border-gray-600/50'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${publicKey ? 'bg-green-400' : 'bg-gray-500'}`} aria-hidden="true" />
          {publicKey ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <p className="text-gray-400 text-sm mb-5 leading-relaxed">
        Authorize a recurring on-chain payment using your Freighter wallet.
      </p>

      {/* Contract ID with copy button */}
      <div className="flex items-center gap-2 mb-8 bg-gray-800/50 border border-gray-700/60 rounded-lg px-3 py-2">
        <span className="text-xs text-gray-500 font-medium shrink-0">Contract</span>
        <code className="flex-1 text-xs text-gray-300 font-mono truncate" title={CONTRACT_ID}>
          {CONTRACT_ID}
        </code>
        <CopyButton text={CONTRACT_ID} label="Copy" />
      </div>

      {/* Progress indicator — visible only while submitting */}
      {isSubmitting && <ProgressBar />}

      {/* Success card */}
      {successData && <SuccessCard data={successData} onReset={resetForm} />}

      {/* Transaction error */}
      {txError && <ErrorCard error={txError} onDismiss={() => setTxError(null)} />}

      {/* Hide the form after success */}
      {!successData && (
        <form onSubmit={handleSubmit} noValidate aria-busy={isSubmitting} aria-labelledby="form-heading" className="space-y-5 sm:space-y-6">

          {/* Merchant address */}
          <div>
            <label htmlFor="merchantAddress" className="block text-sm font-semibold text-gray-300 mb-2.5">
              Merchant address <span aria-hidden="true" className="text-red-400">*</span><span className="sr-only"> (required)</span>
            </label>
            <input
              id="merchantAddress"
              type="text"
              placeholder="GABC…"
              autoComplete="off"
              value={merchantAddress}
              onChange={(e) => setMerchantAddress(e.target.value)}
              disabled={isSubmitting}
              required
              aria-required="true"
              aria-describedby={fieldErrors.merchantAddress ? 'err-merchant' : undefined}
              aria-invalid={!!fieldErrors.merchantAddress}
              className={inputCls}
            />
            {fieldErrors.merchantAddress && (
              <p id="err-merchant" role="alert" className="mt-2 text-xs text-red-400 font-medium">
                {fieldErrors.merchantAddress}
              </p>
            )}
          </div>

          {/* Token address */}
          <div>
            <label htmlFor="tokenAddress" className="block text-sm font-semibold text-gray-300 mb-2.5">
              Token contract address <span aria-hidden="true" className="text-red-400">*</span><span className="sr-only"> (required)</span>
            </label>
            <input
              id="tokenAddress"
              type="text"
              placeholder="CABC…"
              autoComplete="off"
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
              disabled={isSubmitting}
              required
              aria-required="true"
              aria-describedby={fieldErrors.tokenAddress ? 'err-token' : undefined}
              aria-invalid={!!fieldErrors.tokenAddress}
              className={inputCls}
            />
            {fieldErrors.tokenAddress && (
              <p id="err-token" role="alert" className="mt-2 text-xs text-red-400 font-medium">
                {fieldErrors.tokenAddress}
              </p>
            )}
          </div>

          {/* Amount */}
          <div>
            <label htmlFor="amount" className="block text-sm font-semibold text-gray-300 mb-2.5">
              Amount <span className="text-gray-500 font-normal">(token units)</span>{' '}
              <span aria-hidden="true" className="text-red-400">*</span><span className="sr-only"> (required)</span>
            </label>
            <input
              id="amount"
              type="number"
              min="1"
              step="1"
              placeholder="100"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isSubmitting}
              aria-describedby={`help-amount${fieldErrors.amount ? ' err-amount' : ''}`}
              aria-invalid={!!fieldErrors.amount}
              className={inputCls}
            />
            <p id="help-amount" className="mt-2 text-xs text-gray-500 leading-relaxed">
              Must be a positive integer (e.g. 100). Represents the number of token units transferred per interval.
            </p>
            {fieldErrors.amount && (
              <p id="err-amount" role="alert" className="mt-2 text-xs text-red-400 font-medium">
                {fieldErrors.amount}
              </p>
            )}
          </div>

          {/* Interval */}
          <div>
            <label htmlFor="interval" className="block text-sm font-semibold text-gray-300 mb-2.5">
              Interval <span className="text-gray-500 font-normal">(seconds)</span>{' '}
              <span aria-hidden="true" className="text-red-400">*</span><span className="sr-only"> (required)</span>
            </label>
            <input
              id="interval"
              type="number"
              min="86400"
              max="31536000"
              step="1"
              autoComplete="off"
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              disabled={isSubmitting}
              aria-describedby={`help-interval${fieldErrors.interval ? ' err-interval' : ''}`}
              aria-invalid={!!fieldErrors.interval}
              className={inputCls}
            />
            <p id="help-interval" className="mt-2 text-xs text-gray-500 leading-relaxed">
              Seconds between payments. Min: 86 400 s (1 day), max: 31 536 000 s (1 year). Default: 2 592 000 s (30 days).
            </p>
            {fieldErrors.interval && (
              <p id="err-interval" role="alert" className="mt-2 text-xs text-red-400 font-medium">
                {fieldErrors.interval}
              </p>
            )}
          </div>

          {/* Submit */}
          <div>
            {!publicKey && (
              <p id="hint-wallet" className="mb-3 text-xs text-yellow-400 font-medium" role="status">
                Connect your Freighter wallet to enable submission.
              </p>
            )}
            <button
              type="submit"
              disabled={isSubmitting || !publicKey}
              aria-describedby={!publicKey ? 'hint-wallet' : undefined}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600
                         hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50
                         disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold
                         transition-all duration-150 min-h-[48px] hover:shadow-lg active:shadow-md
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
                         focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            >
              {isSubmitting && (
                <svg
                  className="animate-spin h-5 w-5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              )}
              {isSubmitting ? 'Submitting…' : 'Authorize Subscription'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
