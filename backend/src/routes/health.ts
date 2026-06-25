/**
 * #134 — Health endpoint.
 * GET /health  →  200 { status: "ok", ... } | 503 { status: "error", ... }
 *
 * Checks:
 *  1. Soroban RPC is reachable (getHealth)
 *  2. The configured contract ID is resolvable (getContractData produces any response)
 */

import { Router, Request, Response } from 'express';
import { rpc, xdr } from '@stellar/stellar-sdk';

export function buildHealthRouter(rpcUrl: string, contractId: string): Router {
  const router = Router();
  const server = new rpc.Server(rpcUrl);

  router.get('/', async (_req: Request, res: Response) => {
    const checks: Record<string, string> = {};
    let healthy = true;

    // 1. RPC reachability
    try {
      await server.getHealth();
      checks.rpc = 'ok';
    } catch (err) {
      checks.rpc = `error: ${(err as Error).message}`;
      healthy = false;
    }

    // 2. Contract resolvability — getContractData throws when the contract
    //    does not exist or the RPC cannot reach it.
    try {
      await server.getContractData(contractId, xdr.ScVal.scvLedgerKeyContractInstance());
      checks.contract = 'ok';
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      // A "not found" response still means the RPC resolved the address; anything
      // else (network error, invalid ID) is a real failure.
      if (msg.includes('not found') || msg.includes('entryNotFound')) {
        checks.contract = 'ok';
      } else {
        checks.contract = `error: ${msg}`;
        healthy = false;
      }
    }

    const status = healthy ? 'ok' : 'error';
    res.status(healthy ? 200 : 503).json({ status, checks });
  });

  return router;
}
