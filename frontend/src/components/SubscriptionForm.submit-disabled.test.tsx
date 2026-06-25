/**
 * SubscriptionForm.submit-disabled.test.tsx
 *
 * Tests that the submit button is disabled while a subscription
 * transaction is in flight, preventing duplicate submits.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

jest.mock('@/constants/network', () => ({
  CONTRACT_ID: 'CTEST',
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({ publicKey: 'GPUBKEY' }),
}));

// Controllable pending promise keeps isSubmitting=true until resolved
let resolveSubmit: (v: { txHash: string }) => void;
jest.mock('@/lib/transaction_builder', () => ({
  buildAndSubmitSubscribe: () =>
    new Promise<{ txHash: string }>((res) => { resolveSubmit = res; }),
}));

import SubscriptionForm from '@/components/SubscriptionForm';

// Valid Stellar addresses: G|C + exactly 55 chars from [A-Z2-7]
const VALID_MERCHANT = 'G' + 'A'.repeat(55);
const VALID_TOKEN    = 'C' + 'A'.repeat(55);

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/merchant address/i), { target: { value: VALID_MERCHANT } });
  fireEvent.change(screen.getByLabelText(/token contract address/i), { target: { value: VALID_TOKEN } });
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '100' } });
}

describe('SubscriptionForm – submit button disabled while submitting', () => {
  it('is enabled before any submission', () => {
    render(<SubscriptionForm />);
    expect(screen.getByRole('button', { name: /authorize subscription/i })).not.toBeDisabled();
  });

  it('becomes disabled immediately after a valid submit', async () => {
    render(<SubscriptionForm />);
    fillValidForm();

    act(() => {
      fireEvent.submit(
        screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
      );
    });

    await waitFor(() => {
      const btn = screen.getByRole('button');
      expect(btn).toBeDisabled();
      expect(btn).toHaveTextContent(/submitting/i);
    });
  });

  it('is removed after the transaction completes (success card shown)', async () => {
    render(<SubscriptionForm />);
    fillValidForm();

    act(() => {
      fireEvent.submit(
        screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
      );
    });

    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled());

    await act(async () => {
      resolveSubmit({ txHash: 'abc123' });
    });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /submitting/i })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /create another/i })).toBeInTheDocument();
  });
});
