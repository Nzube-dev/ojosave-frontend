"use client";

/**
 * useFormPersist.ts
 *
 * Custom hook for persisting and restoring form field values using sessionStorage.
 * Only persists non-sensitive public data (merchant, token, amount, interval).
 * Wallet-related inputs are never persisted.
 *
 * Issue #115: Persist form field values on page refresh
 */

import { useEffect } from "react";

interface FormData {
  merchantAddress: string;
  tokenAddress: string;
  amount: string;
  interval: string;
}

const STORAGE_KEY = "sorobanpay_form_data";

/**
 * Returns persisted form data from sessionStorage, or defaults if not found.
 */
export function getPersistedFormData(defaultInterval: string): FormData {
  if (typeof window === "undefined") {
    return {
      merchantAddress: "",
      tokenAddress: "",
      amount: "",
      interval: defaultInterval,
    };
  }

  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      return {
        merchantAddress: data.merchantAddress || "",
        tokenAddress: data.tokenAddress || "",
        amount: data.amount || "",
        interval: data.interval || defaultInterval,
      };
    }
  } catch {
    // If parsing fails, silently ignore and use defaults
  }

  return {
    merchantAddress: "",
    tokenAddress: "",
    amount: "",
    interval: defaultInterval,
  };
}

/**
 * Saves form data to sessionStorage.
 */
export function persistFormData(data: FormData): void {
  if (typeof window === "undefined") return;

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Silently fail if sessionStorage is unavailable
  }
}

/**
 * Clears persisted form data from sessionStorage.
 */
export function clearPersistedFormData(): void {
  if (typeof window === "undefined") return;

  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Silently fail if sessionStorage is unavailable
  }
}

/**
 * Hook that auto-persists form data to sessionStorage whenever any field changes.
 * Useful for debounced persistence updates.
 */
export function useFormPersist(data: FormData, debounceMs = 500): void {
  useEffect(() => {
    const timer = setTimeout(() => {
      persistFormData(data);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [data, debounceMs]);
}
