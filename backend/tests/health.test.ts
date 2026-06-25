import request from 'supertest';
import express from 'express';
import { buildHealthRouter } from '../src/routes/health';

// Mock the entire stellar-sdk so Jest never tries to load ESM sub-modules
const mockGetHealth = jest.fn();
const mockGetContractData = jest.fn();

jest.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getHealth: mockGetHealth,
      getContractData: mockGetContractData,
    })),
  },
  xdr: {
    ScVal: {
      scvLedgerKeyContractInstance: jest.fn().mockReturnValue({}),
    },
  },
}));

function buildApp(rpcUrl: string, contractId: string) {
  const app = express();
  app.use('/health', buildHealthRouter(rpcUrl, contractId));
  return app;
}

describe('GET /health', () => {
  const RPC = 'https://soroban-testnet.stellar.org';
  const CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 when both RPC and contract checks pass', async () => {
    mockGetHealth.mockResolvedValue({ status: 'healthy' });
    mockGetContractData.mockResolvedValue({});

    const res = await request(buildApp(RPC, CONTRACT)).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.rpc).toBe('ok');
    expect(res.body.checks.contract).toBe('ok');
  });

  it('returns 200 when contract returns "entryNotFound" (valid address, empty storage)', async () => {
    mockGetHealth.mockResolvedValue({ status: 'healthy' });
    mockGetContractData.mockRejectedValue(new Error('entryNotFound'));

    const res = await request(buildApp(RPC, CONTRACT)).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.checks.contract).toBe('ok');
  });

  it('returns 503 when RPC is unreachable', async () => {
    mockGetHealth.mockRejectedValue(new Error('ECONNREFUSED'));
    mockGetContractData.mockResolvedValue({});

    const res = await request(buildApp(RPC, CONTRACT)).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    expect(res.body.checks.rpc).toMatch(/ECONNREFUSED/);
  });

  it('returns 503 when contract is unresolvable', async () => {
    mockGetHealth.mockResolvedValue({ status: 'healthy' });
    mockGetContractData.mockRejectedValue(new Error('network timeout'));

    const res = await request(buildApp(RPC, CONTRACT)).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.checks.contract).toMatch(/network timeout/);
  });
});
