/**
 * validation.load.test.ts
 *
 * Load tests for validateSubscriptionForm and related helpers.
 *
 * Goals:
 *   1. Verify the validators do not crash or hang under a high volume of calls.
 *   2. Confirm invalid inputs are consistently rejected (no flakiness at scale).
 *   3. Confirm valid inputs are consistently accepted.
 *   4. Simulate "parallel" throttling: fire N promises simultaneously and assert
 *      every one resolves with the expected result without corrupting shared state.
 */

import {
  validateSubscriptionForm,
  isFormValid,
  SubscriptionFormValues,
} from './validation';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // 56 chars, starts with G
const VALID_C = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // 56 chars, starts with C

const VALID_FORM: SubscriptionFormValues = {
  merchantAddress: VALID_G,
  tokenAddress: VALID_C,
  amount: '1000',
  interval: '86400',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Wrap validateSubscriptionForm in a microtask so Promise.all distributes work. */
function validateAsync(values: SubscriptionFormValues) {
  return Promise.resolve().then(() => validateSubscriptionForm(values));
}

// ─── Load: many valid calls in parallel ───────────────────────────────────────

describe('load: bulk valid subscriptions (parallel)', () => {
  const N = 200;

  it(`accepts ${N} valid forms concurrently without errors`, async () => {
    const results = await Promise.all(
      Array.from({ length: N }, () => validateAsync(VALID_FORM))
    );

    for (const errors of results) {
      expect(isFormValid(errors)).toBe(true);
    }
  });
});

// ─── Load: many invalid calls in parallel ─────────────────────────────────────

describe('load: bulk invalid subscriptions (parallel)', () => {
  const N = 200;

  it(`rejects ${N} zero-amount forms concurrently, all returning amount error`, async () => {
    const form = { ...VALID_FORM, amount: '0' };
    const results = await Promise.all(
      Array.from({ length: N }, () => validateAsync(form))
    );

    for (const errors of results) {
      expect(isFormValid(errors)).toBe(false);
      expect(errors.amount).toBeDefined();
      expect(errors.merchantAddress).toBeUndefined();
      expect(errors.tokenAddress).toBeUndefined();
      expect(errors.interval).toBeUndefined();
    }
  });

  it(`rejects ${N} short-interval forms concurrently without state leakage`, async () => {
    const form = { ...VALID_FORM, interval: '86399' };
    const results = await Promise.all(
      Array.from({ length: N }, () => validateAsync(form))
    );

    for (const errors of results) {
      expect(errors.interval).toBeDefined();
      expect(errors.amount).toBeUndefined();
    }
  });

  it(`rejects ${N} fully-invalid forms concurrently with all 4 field errors`, async () => {
    const form: SubscriptionFormValues = {
      merchantAddress: '',
      tokenAddress: '',
      amount: '0',
      interval: '0',
    };
    const results = await Promise.all(
      Array.from({ length: N }, () => validateAsync(form))
    );

    for (const errors of results) {
      expect(Object.keys(errors).length).toBe(4);
    }
  });
});

// ─── Load: mixed valid/invalid interleaved ────────────────────────────────────

describe('load: mixed valid and invalid requests interleaved', () => {
  const N = 100; // N valid + N invalid = 2N total

  it(`correctly classifies ${N * 2} mixed forms with no cross-contamination`, async () => {
    const validForms   = Array.from({ length: N }, () => validateAsync(VALID_FORM));
    const invalidForms = Array.from({ length: N }, () =>
      validateAsync({ ...VALID_FORM, amount: '-1' })
    );

    // Interleave by zipping
    const mixed = validForms.flatMap((v, i) => [v, invalidForms[i]]);
    const results = await Promise.all(mixed);

    for (let i = 0; i < results.length; i++) {
      if (i % 2 === 0) {
        expect(isFormValid(results[i])).toBe(true);
      } else {
        expect(results[i].amount).toBeDefined();
      }
    }
  });
});

// ─── Load: sequential repeated calls (performance regression guard) ───────────

describe('load: sequential repeated validation calls', () => {
  const N = 500;

  it(`completes ${N} sequential validations well within timeout`, () => {
    const start = Date.now();

    for (let i = 0; i < N; i++) {
      // Alternate between valid and invalid each iteration
      const form = i % 2 === 0
        ? VALID_FORM
        : { ...VALID_FORM, amount: String(-i) };
      validateSubscriptionForm(form);
    }

    const elapsed = Date.now() - start;
    // Pure JS validation — 500 iterations must complete in well under 500 ms.
    expect(elapsed).toBeLessThan(500);
  });
});
