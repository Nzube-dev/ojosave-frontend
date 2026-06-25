/**
 * validation.test.ts
 *
 * Unit tests for subscription form validation logic.
 * Tests cover:
 *  - Invalid merchant address (empty, malformed, non-account)
 *  - Invalid token address (empty, malformed, non-contract)
 *  - Zero and negative amounts
 *  - Interval boundary conditions (too short, too long)
 *  - Valid form submissions
 */

import {
  validateMerchantAddress,
  validateTokenAddress,
  validateAmount,
  validateInterval,
  validateSubscriptionForm,
  isFormValid,
  MIN_INTERVAL_SECONDS,
  MAX_INTERVAL_SECONDS,
} from './validation';

// ─── Merchant Address Tests ────────────────────────────────────────────────────

describe('validateMerchantAddress', () => {
  it('should reject empty merchant address', () => {
    expect(validateMerchantAddress('')).toBeDefined();
    expect(validateMerchantAddress('   ')).toBeDefined();
  });

  it('should reject invalid merchant address format', () => {
    expect(validateMerchantAddress('INVALID')).toBeDefined();
    expect(validateMerchantAddress('G')).toBeDefined();
    expect(validateMerchantAddress('GA')).toBeDefined(); // Too short
    expect(validateMerchantAddress('CABC123DEFG456HIJK789LMNOP123QRST456UVWX789YZAB123CDEF456')).toBeDefined(); // Starts with C
  });

  it('should accept valid merchant address', () => {
    // Valid 56-char address starting with G (Stellar base32: A-Z, 2-7)
    const valid = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(validateMerchantAddress(valid)).toBeUndefined();
  });

  it('should trim whitespace from merchant address', () => {
    const valid = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(validateMerchantAddress(`  ${valid}  `)).toBeUndefined();
  });
});

// ─── Token Address Tests ───────────────────────────────────────────────────────

describe('validateTokenAddress', () => {
  it('should reject empty token address', () => {
    expect(validateTokenAddress('')).toBeDefined();
    expect(validateTokenAddress('   ')).toBeDefined();
  });

  it('should reject invalid token address format', () => {
    expect(validateTokenAddress('INVALID')).toBeDefined();
    expect(validateTokenAddress('C')).toBeDefined();
    expect(validateTokenAddress('CA')).toBeDefined(); // Too short
    expect(validateTokenAddress('GABC123DEFG456HIJK789LMNOP123QRST456UVWX789YZAB123CDEFG')).toBeDefined(); // Starts with G
  });

  it('should accept valid token address', () => {
    // Valid 56-char contract starting with C (Stellar base32: A-Z, 2-7)
    const valid = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(validateTokenAddress(valid)).toBeUndefined();
  });

  it('should trim whitespace from token address', () => {
    const valid = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(validateTokenAddress(`  ${valid}  `)).toBeUndefined();
  });
});

// ─── Amount Tests ──────────────────────────────────────────────────────────────

describe('validateAmount', () => {
  it('should reject empty amount', () => {
    expect(validateAmount('')).toBeDefined();
    expect(validateAmount('   ')).toBeDefined();
  });

  it('should reject zero amount', () => {
    expect(validateAmount('0')).toBeDefined();
  });

  it('should reject negative amount', () => {
    expect(validateAmount('-1')).toBeDefined();
    expect(validateAmount('-100')).toBeDefined();
  });

  it('should reject non-numeric amount', () => {
    expect(validateAmount('abc')).toBeDefined();
    expect(validateAmount('12.34')).toBeDefined(); // Non-integer
    expect(validateAmount('NaN')).toBeDefined();
  });

  it('should accept positive integer amounts', () => {
    expect(validateAmount('1')).toBeUndefined();
    expect(validateAmount('100')).toBeUndefined();
    expect(validateAmount('1000000')).toBeUndefined();
  });
});

// ─── Interval Tests ────────────────────────────────────────────────────────────

describe('validateInterval', () => {
  it('should reject empty interval', () => {
    expect(validateInterval('')).toBeDefined();
    expect(validateInterval('   ')).toBeDefined();
  });

  it('should reject interval below minimum (86400 seconds)', () => {
    expect(validateInterval('0')).toBeDefined();
    expect(validateInterval('86399')).toBeDefined();
  });

  it('should reject interval above maximum (31536000 seconds)', () => {
    expect(validateInterval('31536001')).toBeDefined();
    expect(validateInterval('100000000')).toBeDefined();
  });

  it('should reject non-integer interval', () => {
    expect(validateInterval('86400.5')).toBeDefined();
    expect(validateInterval('abc')).toBeDefined();
  });

  it('should accept interval at minimum boundary', () => {
    expect(validateInterval(String(MIN_INTERVAL_SECONDS))).toBeUndefined();
  });

  it('should accept interval at maximum boundary', () => {
    expect(validateInterval(String(MAX_INTERVAL_SECONDS))).toBeUndefined();
  });

  it('should accept interval within valid range', () => {
    expect(validateInterval('86400')).toBeUndefined();    // 1 day
    expect(validateInterval('604800')).toBeUndefined();   // 7 days
    expect(validateInterval('2592000')).toBeUndefined();  // 30 days
    expect(validateInterval('31536000')).toBeUndefined(); // 1 year
  });
});

// ─── Form Validation Tests ─────────────────────────────────────────────────────

describe('validateSubscriptionForm', () => {
  const validMerchant = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const validToken = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  it('should return empty object for valid form', () => {
    const errors = validateSubscriptionForm({
      merchantAddress: validMerchant,
      tokenAddress: validToken,
      amount: '100',
      interval: '86400',
    });
    expect(isFormValid(errors)).toBe(true);
    expect(Object.keys(errors).length).toBe(0);
  });

  it('should report invalid merchant address', () => {
    const errors = validateSubscriptionForm({
      merchantAddress: 'INVALID',
      tokenAddress: validToken,
      amount: '100',
      interval: '86400',
    });
    expect(errors.merchantAddress).toBeDefined();
    expect(errors.tokenAddress).toBeUndefined();
  });

  it('should report invalid token address', () => {
    const errors = validateSubscriptionForm({
      merchantAddress: validMerchant,
      tokenAddress: 'INVALID',
      amount: '100',
      interval: '86400',
    });
    expect(errors.tokenAddress).toBeDefined();
    expect(errors.merchantAddress).toBeUndefined();
  });

  it('should report zero amount', () => {
    const errors = validateSubscriptionForm({
      merchantAddress: validMerchant,
      tokenAddress: validToken,
      amount: '0',
      interval: '86400',
    });
    expect(errors.amount).toBeDefined();
  });

  it('should report interval too short', () => {
    const errors = validateSubscriptionForm({
      merchantAddress: validMerchant,
      tokenAddress: validToken,
      amount: '100',
      interval: '86399',
    });
    expect(errors.interval).toBeDefined();
  });

  it('should report interval too long', () => {
    const errors = validateSubscriptionForm({
      merchantAddress: validMerchant,
      tokenAddress: validToken,
      amount: '100',
      interval: '31536001',
    });
    expect(errors.interval).toBeDefined();
  });

  it('should report multiple errors simultaneously', () => {
    const errors = validateSubscriptionForm({
      merchantAddress: '',
      tokenAddress: '',
      amount: '0',
      interval: '0',
    });
    expect(Object.keys(errors).length).toBe(4);
    expect(errors.merchantAddress).toBeDefined();
    expect(errors.tokenAddress).toBeDefined();
    expect(errors.amount).toBeDefined();
    expect(errors.interval).toBeDefined();
  });
});

// ─── isFormValid Tests ─────────────────────────────────────────────────────────

describe('isFormValid', () => {
  it('should return true when errors object is empty', () => {
    expect(isFormValid({})).toBe(true);
  });

  it('should return false when errors object has any key', () => {
    expect(isFormValid({ merchantAddress: 'invalid' })).toBe(false);
    expect(isFormValid({ amount: 'must be positive' })).toBe(false);
    expect(isFormValid({
      merchantAddress: 'invalid',
      amount: 'must be positive',
    })).toBe(false);
  });
});
