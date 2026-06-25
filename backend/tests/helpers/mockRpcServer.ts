/**
 * mockRpcServer.ts
 *
 * In-process mock of the Soroban RPC `getEvents` endpoint.
 * Avoids real network calls in integration tests.
 */

import * as http from 'http';

export interface MockRpcEvent {
  type: string;      // "subscribe" | "executed"
  subscriber: string;
  merchant: string;
  token: string;
  amount: string;    // numeric string
  ledger: number;
}

export class MockRpcServer {
  private server: http.Server;
  private events: MockRpcEvent[] = [];
  public baseUrl = '';

  constructor() {
    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
      }

      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.buildResponse(body)));
      });
    });
  }

  /** Start the server on a random port. */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as { port: number };
        this.baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) =>
      this.server.close((err) => (err ? reject(err) : resolve())),
    );
  }

  /** Replace the event set returned by subsequent RPC calls. */
  setEvents(events: MockRpcEvent[]): void {
    this.events = events;
  }

  private buildResponse(body: string): object {
    let method = '';
    try {
      method = JSON.parse(body).method;
    } catch {
      /* ignore */
    }

    if (method === 'getEvents') {
      return {
        jsonrpc: '2.0',
        id: 1,
        result: {
          events: this.events.map((e) => this.encodeEvent(e)),
          latestLedger: 999,
        },
      };
    }

    // Fallback for any other RPC methods (e.g. getLatestLedger)
    return { jsonrpc: '2.0', id: 1, result: { sequence: 999 } };
  }

  private encodeEvent(e: MockRpcEvent): object {
    // Return raw base64-encoded XDR topic stubs that EventIndexer expects.
    // We encode each field as a ScVal symbol / address / i128 using the
    // stellar-sdk so the real decoder in EventIndexer can parse them.
    const { xdr } = require('@stellar/stellar-sdk');

    const toBase64 = (scVal: unknown) =>
      (scVal as { toXDR: (fmt: string) => string }).toXDR('base64');

    return {
      topic: [
        toBase64(xdr.ScVal.scvSymbol(e.type)),
        toBase64(
          xdr.ScVal.scvAddress(
            xdr.ScAddress.scAddressTypeAccount(
              xdr.PublicKey.publicKeyTypeEd25519(
                Buffer.alloc(32).fill(1),
              ),
            ),
          ),
        ),
        toBase64(
          xdr.ScVal.scvAddress(
            xdr.ScAddress.scAddressTypeAccount(
              xdr.PublicKey.publicKeyTypeEd25519(
                Buffer.alloc(32).fill(2),
              ),
            ),
          ),
        ),
        toBase64(
          xdr.ScVal.scvAddress(
            xdr.ScAddress.scAddressTypeContract(Buffer.alloc(32).fill(3)),
          ),
        ),
      ],
      value: toBase64(
        xdr.ScVal.scvI128(
          new xdr.Int128Parts({
            hi: xdr.Int64.fromString('0'),
            lo: xdr.Uint64.fromString(e.amount),
          }),
        ),
      ),
      ledger: e.ledger,
      contractId: 'CTEST',
      id: `${e.ledger}-0`,
      pagingToken: `${e.ledger}-0`,
      inSuccessfulContractCall: true,
      ledgerClosedAt: new Date().toISOString(),
      txHash: 'deadbeef',
      type: 'contract',
    };
  }
}
