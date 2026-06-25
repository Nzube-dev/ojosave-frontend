/**
 * #137 — Runtime config validation.
 * Call validateConfig() before starting the server; it throws on any bad value.
 */

export interface AppConfig {
  rpcUrl: string;
  contractId: string;
  networkPassphrase: string;
  port: number;
  databaseUrl: string;
}

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const URL_RE = /^https?:\/\/.+/;
const KNOWN_PASSPHRASES = new Set([
  'Test SDF Network ; September 2015',
  'Public Global Stellar Network ; September 2015',
]);

export class ConfigValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
  }
}

export function validateConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const errors: string[] = [];

  const rpcUrl = env.RPC_URL ?? '';
  if (!rpcUrl) {
    errors.push('RPC_URL is required');
  } else if (!URL_RE.test(rpcUrl)) {
    errors.push(`RPC_URL must be a valid http/https URL, got: ${rpcUrl}`);
  }

  const contractId = env.CONTRACT_ID ?? '';
  if (!contractId) {
    errors.push('CONTRACT_ID is required');
  } else if (!CONTRACT_ID_RE.test(contractId)) {
    errors.push(
      `CONTRACT_ID must be a 56-character Stellar contract address starting with "C", got: ${contractId}`,
    );
  }

  const networkPassphrase = env.NETWORK_PASSPHRASE ?? '';
  if (!networkPassphrase) {
    errors.push('NETWORK_PASSPHRASE is required');
  } else if (!KNOWN_PASSPHRASES.has(networkPassphrase)) {
    errors.push(
      `NETWORK_PASSPHRASE is not a recognised Stellar network passphrase: "${networkPassphrase}"`,
    );
  }

  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl) {
    errors.push('DATABASE_URL is required');
  }

  const rawPort = env.PORT;
  const port = rawPort ? parseInt(rawPort, 10) : 3001;
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`PORT must be a valid port number, got: ${rawPort}`);
  }

  if (errors.length > 0) {
    throw new ConfigValidationError(errors);
  }

  return { rpcUrl, contractId, networkPassphrase, databaseUrl, port };
}
