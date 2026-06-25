/**
 * #135 — Retry policy for failed contract calls.
 *
 * withRetry(fn, opts) — generic exponential-backoff retry.
 * isTransient(err)   — decides if an error warrants a retry.
 *
 * Usage:
 *   const result = await withRetry(() => executePayment(sub, merchant), {
 *     idempotencyKey: `${sub}:${merchant}:${ledger}`,
 *   });
 */

export interface RetryOptions {
  /** Maximum attempts (first call + retries). Default: 4 */
  maxAttempts?: number;
  /** Base delay in ms. Doubles each attempt. Default: 500 */
  baseDelayMs?: number;
  /** Maximum delay cap in ms. Default: 10_000 */
  maxDelayMs?: number;
  /**
   * Unique key for this operation. When provided the first successful result
   * is cached so that concurrent or duplicate calls return the same value
   * instead of re-submitting.
   */
  idempotencyKey?: string;
}

export class RetryExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly lastError: unknown,
  ) {
    super(
      `Operation failed after ${attempts} attempt(s): ${(lastError as Error)?.message ?? lastError}`,
    );
    this.name = 'RetryExhaustedError';
  }
}

/** Returns true for errors that are safe to retry (transient / network). */
export function isTransient(err: unknown): boolean {
  const msg = ((err as Error)?.message ?? String(err)).toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('network') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('429')
  );
}

// In-process idempotency cache: key → pending promise (or settled value)
const _cache = new Map<string, Promise<unknown>>();

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 4,
    baseDelayMs = 500,
    maxDelayMs = 10_000,
    idempotencyKey,
  } = opts;

  // Return cached promise for duplicate calls with the same key
  if (idempotencyKey && _cache.has(idempotencyKey)) {
    return _cache.get(idempotencyKey) as Promise<T>;
  }

  const attempt = async (): Promise<T> => {
    let lastError: unknown;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (!isTransient(err) || i === maxAttempts - 1) break;
        const delay = Math.min(baseDelayMs * 2 ** i, maxDelayMs);
        await sleep(delay);
      }
    }
    throw new RetryExhaustedError(maxAttempts, lastError);
  };

  const promise = attempt();

  if (idempotencyKey) {
    _cache.set(idempotencyKey, promise);
    // Remove from cache once settled so transient failures don't stick forever
    promise.catch(() => _cache.delete(idempotencyKey));
  }

  return promise;
}

/** Clears the idempotency cache — useful in tests. */
export function clearRetryCache(): void {
  _cache.clear();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
