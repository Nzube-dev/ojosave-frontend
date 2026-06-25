import { validateConfig, ConfigValidationError } from '../src/lib/config';

const VALID_ENV = {
  RPC_URL: 'https://soroban-testnet.stellar.org',
  CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/sorobanpay',
  PORT: '3001',
} as NodeJS.ProcessEnv;

describe('validateConfig', () => {
  it('returns a typed config for a valid environment', () => {
    const config = validateConfig(VALID_ENV);
    expect(config.rpcUrl).toBe(VALID_ENV.RPC_URL);
    expect(config.contractId).toBe(VALID_ENV.CONTRACT_ID);
    expect(config.networkPassphrase).toBe(VALID_ENV.NETWORK_PASSPHRASE);
    expect(config.port).toBe(3001);
  });

  it('accepts mainnet passphrase', () => {
    const env = {
      ...VALID_ENV,
      NETWORK_PASSPHRASE: 'Public Global Stellar Network ; September 2015',
    };
    expect(() => validateConfig(env)).not.toThrow();
  });

  it('defaults PORT to 3001 when absent', () => {
    const { PORT: _, ...env } = VALID_ENV;
    expect(validateConfig(env as NodeJS.ProcessEnv).port).toBe(3001);
  });

  it('throws ConfigValidationError when RPC_URL is missing', () => {
    const { RPC_URL: _, ...env } = VALID_ENV;
    expect(() => validateConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);
  });

  it('throws when RPC_URL is not a valid URL', () => {
    try {
      validateConfig({ ...VALID_ENV, RPC_URL: 'not-a-url' });
      fail('should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      expect((e as ConfigValidationError).errors).toContainEqual(
        expect.stringMatching(/RPC_URL must be/),
      );
    }
  });

  it('throws when CONTRACT_ID is missing', () => {
    const { CONTRACT_ID: _, ...env } = VALID_ENV;
    expect(() => validateConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);
  });

  it('throws when CONTRACT_ID has wrong format', () => {
    try {
      validateConfig({ ...VALID_ENV, CONTRACT_ID: 'GNOTACONTRACTID' });
      fail('should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      expect((e as ConfigValidationError).errors).toContainEqual(
        expect.stringMatching(/CONTRACT_ID must be/),
      );
    }
  });

  it('throws when NETWORK_PASSPHRASE is unknown', () => {
    try {
      validateConfig({ ...VALID_ENV, NETWORK_PASSPHRASE: 'wrong passphrase' });
      fail('should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      expect((e as ConfigValidationError).errors).toContainEqual(
        expect.stringMatching(/NETWORK_PASSPHRASE is not a recognised/),
      );
    }
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _, ...env } = VALID_ENV;
    expect(() => validateConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigValidationError);
  });

  it('accumulates multiple errors in a single throw', () => {
    try {
      validateConfig({} as NodeJS.ProcessEnv);
      fail('should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      expect((e as ConfigValidationError).errors.length).toBeGreaterThan(1);
    }
  });
});
