/**
 * SubscriptionForm.accessibility.test.tsx
 *
 * Accessibility tests for SubscriptionForm:
 *  - Labels are present and associated with inputs
 *  - aria-invalid and aria-describedby set correctly on errors
 *  - Error messages have role="alert"
 *  - Form fields are keyboard-navigable
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/constants/network', () => ({
  CONTRACT_ID: 'CTEST',
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({ publicKey: 'GPUBKEY' }),
}));

jest.mock('@/lib/transaction_builder', () => ({
  buildAndSubmitSubscribe: () => new Promise(() => {}),
}));

import SubscriptionForm from '@/components/SubscriptionForm';

describe('SubscriptionForm – accessibility', () => {
  beforeEach(() => render(<SubscriptionForm />));

  it('renders a labelled input for every field', () => {
    expect(screen.getByLabelText(/merchant address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/token contract address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/interval/i)).toBeInTheDocument();
  });

  it('associates each label via htmlFor / id', () => {
    for (const id of ['merchantAddress', 'tokenAddress', 'amount', 'interval']) {
      expect(document.getElementById(id)).not.toBeNull();
      expect(document.querySelector(`label[for="${id}"]`)).not.toBeNull();
    }
  });

  it('inputs are not aria-invalid before any submission', () => {
    for (const id of ['merchantAddress', 'tokenAddress', 'amount', 'interval']) {
      expect(document.getElementById(id)).toHaveAttribute('aria-invalid', 'false');
    }
  });

  it('sets aria-invalid="true" and aria-describedby on invalid fields after bad submit', async () => {
    fireEvent.submit(screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!);
    await waitFor(() => {
      expect(screen.getByLabelText(/merchant address/i)).toHaveAttribute('aria-invalid', 'true');
    });
    expect(screen.getByLabelText(/merchant address/i)).toHaveAttribute('aria-describedby', 'err-merchant');
  });

  it('error messages carry role="alert"', async () => {
    fireEvent.submit(screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!);
    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    });
  });

  it('submit button is reachable by keyboard Tab from first input', async () => {
    const user = userEvent.setup();
    screen.getByLabelText(/merchant address/i).focus();
    await user.tab(); // token
    await user.tab(); // amount
    await user.tab(); // interval
    await user.tab(); // submit
    expect(screen.getByRole('button', { name: /authorize subscription/i })).toHaveFocus();
  });

  it('inputs accept keyboard input', async () => {
    const user = userEvent.setup();
    const input = screen.getByLabelText(/merchant address/i);
    await user.click(input);
    await user.type(input, 'GABC');
    expect(input).toHaveValue('GABC');
  });
});
