/**
 * validation.ts
 *
 * Frontend form validation for subscription creation.
 * Validates merchant address, token address, amount, and interval constraints.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_INTERVAL_SECONDS = 2_592_000; // 30 days
export const MIN_INTERVAL_SECONDS = 86_400; // 1 day
export const MAX_INTERVAL_SECONDS = 31_536_000; // 1 year

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FieldErrors {
  merchantAddress?: string;
  tokenAddress?: string;
  amount?: string;
  interval?: string;
}

export interface SubscriptionFormData {
  merchantAddress: string;
  tokenAddress: string;
  amount: string;
  interval: string;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * Check if a string is a valid Stellar account address (starts with 'G' and is 56 chars).
 */
function isValidAccountAddress(address: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(address.trim());
}

/**
 * Check if a string is a valid Stellar contract address (starts with 'C' and is 56 chars).
 */
function isValidContractAddress(address: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(address.trim());
}

/**
 * Validate merchant address.
 */
export function validateMerchantAddress(address: string): string | undefined {
  if (!address || !address.trim()) {
    return 'Merchant address is required';
  }
  if (!isValidAccountAddress(address)) {
    return 'Invalid merchant address (must be 56-char account starting with G)';
  }
  return undefined;
}

/**
 * Validate token contract address.
 */
export function validateTokenAddress(address: string): string | undefined {
  if (!address || !address.trim()) {
    return 'Token address is required';
  }
  if (!isValidContractAddress(address)) {
    return 'Invalid token address (must be 56-char contract starting with C)';
  }
  return undefined;
}

/**
 * Validate payment amount (must be positive number).
 */
export function validateAmount(amountStr: string): string | undefined {
  if (!amountStr || !amountStr.trim()) {
    return 'Amount is required';
  }

  const amount = Number(amountStr);
  if (isNaN(amount)) {
    return 'Amount must be a valid number';
  }

  if (amount <= 0) {
    return 'Amount must be greater than zero';
  }

  if (!Number.isInteger(amount)) {
    return 'Amount must be a whole number';
  }

  return undefined;
}

/**
 * Validate interval (must be within [86400, 31536000] seconds).
 */
export function validateInterval(intervalStr: string): string | undefined {
  if (!intervalStr || !intervalStr.trim()) {
    return 'Interval is required';
  }

  const interval = Number(intervalStr);
  if (isNaN(interval)) {
    return 'Interval must be a valid number';
  }

  if (!Number.isInteger(interval)) {
    return 'Interval must be a whole number of seconds';
  }

  if (interval < MIN_INTERVAL_SECONDS) {
    return `Interval must be at least ${MIN_INTERVAL_SECONDS} seconds (1 day)`;
  }

  if (interval > MAX_INTERVAL_SECONDS) {
    return `Interval cannot exceed ${MAX_INTERVAL_SECONDS} seconds (1 year)`;
  }

  return undefined;
}

/**
 * Validate the entire subscription form.
 * Returns a map of field names to error messages (empty if valid).
 */
export function validateSubscriptionForm(data: SubscriptionFormData): FieldErrors {
  const errors: FieldErrors = {};

  const merchantErr = validateMerchantAddress(data.merchantAddress);
  if (merchantErr) errors.merchantAddress = merchantErr;

  const tokenErr = validateTokenAddress(data.tokenAddress);
  if (tokenErr) errors.tokenAddress = tokenErr;

  const amountErr = validateAmount(data.amount);
  if (amountErr) errors.amount = amountErr;

  const intervalErr = validateInterval(data.interval);
  if (intervalErr) errors.interval = intervalErr;

  return errors;
}

/**
 * Check if there are any field errors (form is invalid if any errors exist).
 */
export function isFormValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}
