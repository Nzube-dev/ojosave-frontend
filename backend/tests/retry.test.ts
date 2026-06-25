import {
  withRetry,
  isTransient,
  RetryExhaustedError,
  clearRetryCache,
} from '../src/lib/retry';

jest.useFakeTimers();

/** Runs all pending timers and microtasks until the promise settles. */
async function settle<T>(p: Promise<T>): Promise<T> {
  // Catch rejections early so Jest doesn't see unhandled rejections
  let settled = false;
  p.then(() => (settled = true)).catch(() => (settled = true));

  for (let i = 0; i < 30 && !settled; i++) {
    jest.runAllTimers();
    await Promise.resolve(); // flush microtasks
  }
  return p;
}

describe('isTransient', () => {
  it.each([
    'Connection timeout',
    'ECONNREFUSED',
    'ECONNRESET',
    'network error',
    'rate limit exceeded',
    'Too Many Requests',
    '503 Service Unavailable',
    '502 Bad Gateway',
    '429',
  ])('returns true for "%s"', (msg) => {
    expect(isTransient(new Error(msg))).toBe(true);
  });

  it('returns false for non-transient errors', () => {
    expect(isTransient(new Error('Unauthorized'))).toBe(false);
    expect(isTransient(new Error('invalid contract ID'))).toBe(false);
  });
});

describe('withRetry', () => {
  beforeEach(() => clearRetryCache());

  it('resolves immediately when fn succeeds on first call', async () => {
    const fn = jest.fn().mockResolvedValue('done');
    await expect(withRetry(fn, { maxAttempts: 3 })).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient error and succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue('ok');

    const p = withRetry(fn, { maxAttempts: 3, baseDelayMs: 100 });
    await expect(settle(p)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws RetryExhaustedError after all attempts fail', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('timeout'));
    const p = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    await expect(settle(p)).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-transient errors', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('Unauthorized'));
    const p = withRetry(fn, { maxAttempts: 4 });
    await expect(settle(p)).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent calls with the same idempotencyKey', async () => {
    const fn = jest.fn().mockResolvedValue('result');
    const key = 'subscriber:merchant:100';

    const [r1, r2] = await Promise.all([
      withRetry(fn, { idempotencyKey: key }),
      withRetry(fn, { idempotencyKey: key }),
    ]);

    expect(r1).toBe('result');
    expect(r2).toBe('result');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('delays respect maxDelayMs cap', async () => {
    const delaysSeen: number[] = [];
    const realSetTimeout = globalThis.setTimeout;

    jest.spyOn(globalThis, 'setTimeout').mockImplementation((cb: () => void, ms?: number) => {
      if (typeof ms === 'number' && ms > 0) delaysSeen.push(ms);
      return realSetTimeout(cb, 0);
    });

    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue('ok');

    const p = withRetry(fn, { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 600 });
    await settle(p);

    delaysSeen.forEach((d) => expect(d).toBeLessThanOrEqual(600));
    jest.restoreAllMocks();
  });
});
