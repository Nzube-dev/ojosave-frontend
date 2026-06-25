/**
 * WalletContext.test.tsx
 *
 * Tests wallet disconnect and reconnect flows:
 *  - state resets on disconnect
 *  - reconnect re-populates publicKey
 *  - errors are cleared on disconnect
 *  - useWallet throws outside provider
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { WalletProvider } from '@/context/WalletContext';
import { useWallet } from '@/hooks/useWallet';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@/lib/wallet_manager', () => ({
  detectFreighter: jest.fn(),
  connectWallet:   jest.fn(),
}));

import * as walletManager from '@/lib/wallet_manager';

const mockDetect  = walletManager.detectFreighter as jest.Mock;
const mockConnect = walletManager.connectWallet   as jest.Mock;

// ── Test component ────────────────────────────────────────────────────────────

function WalletConsumer() {
  const { publicKey, isConnecting, connectError, freighterInstalled, connect, disconnect } = useWallet();
  return (
    <div>
      <span data-testid="pk">{publicKey ?? 'null'}</span>
      <span data-testid="connecting">{String(isConnecting)}</span>
      <span data-testid="error">{connectError ?? 'null'}</span>
      <span data-testid="installed">{String(freighterInstalled)}</span>
      <button onClick={connect}    data-testid="connect-btn">connect</button>
      <button onClick={disconnect} data-testid="disconnect-btn">disconnect</button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <WalletProvider>
      <WalletConsumer />
    </WalletProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WalletContext – disconnect flow', () => {
  beforeEach(() => {
    mockDetect.mockResolvedValue(true);
    mockConnect.mockResolvedValue('GPUBLICKEY123');
  });

  it('starts with publicKey null', () => {
    renderWithProvider();
    expect(screen.getByTestId('pk').textContent).toBe('null');
  });

  it('sets publicKey after successful connect', async () => {
    renderWithProvider();
    await act(async () => {
      screen.getByTestId('connect-btn').click();
    });
    expect(screen.getByTestId('pk').textContent).toBe('GPUBLICKEY123');
  });

  it('resets publicKey to null on disconnect', async () => {
    renderWithProvider();
    await act(async () => { screen.getByTestId('connect-btn').click(); });
    expect(screen.getByTestId('pk').textContent).toBe('GPUBLICKEY123');

    act(() => { screen.getByTestId('disconnect-btn').click(); });
    expect(screen.getByTestId('pk').textContent).toBe('null');
  });

  it('clears connectError on disconnect', async () => {
    mockConnect.mockRejectedValueOnce(new Error('user rejected'));
    renderWithProvider();

    await act(async () => { screen.getByTestId('connect-btn').click(); });
    expect(screen.getByTestId('error').textContent).toBe('user rejected');

    act(() => { screen.getByTestId('disconnect-btn').click(); });
    expect(screen.getByTestId('error').textContent).toBe('null');
  });
});

describe('WalletContext – reconnect flow', () => {
  beforeEach(() => {
    mockDetect.mockResolvedValue(true);
  });

  it('allows reconnect after disconnect and updates publicKey', async () => {
    mockConnect
      .mockResolvedValueOnce('GFIRST')
      .mockResolvedValueOnce('GSECOND');

    renderWithProvider();

    // first connect
    await act(async () => { screen.getByTestId('connect-btn').click(); });
    expect(screen.getByTestId('pk').textContent).toBe('GFIRST');

    // disconnect
    act(() => { screen.getByTestId('disconnect-btn').click(); });
    expect(screen.getByTestId('pk').textContent).toBe('null');

    // reconnect with different key
    await act(async () => { screen.getByTestId('connect-btn').click(); });
    expect(screen.getByTestId('pk').textContent).toBe('GSECOND');
  });

  it('shows reconnect prompt (connectError) when Freighter not installed', async () => {
    mockDetect.mockResolvedValue(false);
    renderWithProvider();

    await act(async () => { screen.getByTestId('connect-btn').click(); });
    expect(screen.getByTestId('error').textContent).toContain('Freighter is not installed');
    expect(screen.getByTestId('installed').textContent).toBe('false');
    expect(screen.getByTestId('pk').textContent).toBe('null');
  });

  it('resets error state and allows fresh connect after failed attempt', async () => {
    mockConnect
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce('GNEWKEY');

    renderWithProvider();

    // first attempt fails
    await act(async () => { screen.getByTestId('connect-btn').click(); });
    expect(screen.getByTestId('error').textContent).toBe('denied');

    // second attempt succeeds — error should clear, key should populate
    await act(async () => { screen.getByTestId('connect-btn').click(); });
    expect(screen.getByTestId('error').textContent).toBe('null');
    expect(screen.getByTestId('pk').textContent).toBe('GNEWKEY');
  });
});

describe('useWallet – outside provider', () => {
  it('throws a descriptive error when used outside WalletProvider', () => {
    // Suppress React's error boundary noise in test output
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<WalletConsumer />)).toThrow(/WalletProvider/);
    spy.mockRestore();
  });
});
