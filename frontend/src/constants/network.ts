export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? 'https://soroban-testnet.stellar.org';

export const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ??
  'Test SDF Network ; September 2015';

export const CONTRACT_ID =
  process.env.NEXT_PUBLIC_CONTRACT_ID ?? '';

export const NETWORK_NAME =
  NETWORK_PASSPHRASE === 'Public Global Stellar Network ; September 2015'
    ? 'Mainnet'
    : 'Testnet';
