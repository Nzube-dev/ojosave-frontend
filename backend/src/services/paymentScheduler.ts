import {
  Keypair,
  rpc as SorobanRpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Address,
  Contract,
} from '@stellar/stellar-sdk';
import prisma from '../lib/prisma';

/**
 * PaymentScheduler — discovers due subscriptions from the event index and
 * submits execute_payment transactions on behalf of the operator keypair.
 *
 * Subscriptions are considered "due" when:
 *   last `executed` event timestamp + interval <= now
 *   (or, for first payment: `subscribe` event timestamp + interval <= now)
 */
export class PaymentScheduler {
  private server: SorobanRpc.Server;
  private contractId: string;
  private operatorKeypair: Keypair;
  private networkPassphrase: string;

  constructor(
    rpcUrl: string,
    contractId: string,
    operatorSecret: string,
    networkPassphrase: string = Networks.TESTNET,
  ) {
    this.server = new SorobanRpc.Server(rpcUrl);
    this.contractId = contractId;
    this.operatorKeypair = Keypair.fromSecret(operatorSecret);
    this.networkPassphrase = networkPassphrase;
  }

  /** Main entry point called by the cron job. */
  async processDuePayments(): Promise<void> {
    const due = await this.findDueSubscriptions();
    if (due.length === 0) {
      console.log('[scheduler] No due payments found.');
      return;
    }
    console.log(`[scheduler] Found ${due.length} due subscription(s). Executing…`);

    for (const { subscriber, merchant } of due) {
      try {
        const txHash = await this.executePayment(subscriber, merchant);
        console.log(`[scheduler] execute_payment OK  ${subscriber}→${merchant}  tx=${txHash}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[scheduler] execute_payment FAIL ${subscriber}→${merchant}: ${msg}`);
      }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Derive due subscriptions from the stored event log.
   * A subscription is due when now >= subscribe_time + interval and no
   * `executed` event has been recorded yet, OR when now >= last_executed + interval.
   */
  private async findDueSubscriptions(): Promise<{ subscriber: string; merchant: string }[]> {
    const nowSec = Math.floor(Date.now() / 1000);

    // Fetch all subscribe events (gives us known (subscriber, merchant) pairs)
    const subscribeEvents = await prisma.event.findMany({
      where: { type: 'subscribe' },
      orderBy: { ledgerTimestamp: 'desc' },
      // Take the latest subscribe event per pair to get the current interval/amount
      distinct: ['subscriber', 'merchant'],
    });

    const due: { subscriber: string; merchant: string }[] = [];

    for (const sub of subscribeEvents) {
      // Find the most recent executed event for this pair
      const lastExec = await prisma.event.findFirst({
        where: { type: 'executed', subscriber: sub.subscriber, merchant: sub.merchant },
        orderBy: { ledgerTimestamp: 'desc' },
      });

      // Resolve interval: stored in a subscribe event's amount field is token amount,
      // not interval. We approximate interval from two consecutive events or fall back
      // to a query by checking if any executed event exists within the last interval.
      // Since interval isn't directly stored in the Event table, we use a heuristic:
      // treat the gap between subscribe timestamp and now as the eligibility window.
      // Merchants should call execute_payment once per interval; we trigger when
      // no executed event exists OR when the time since last execution exceeds
      // the minimum interval (1 day = 86400 seconds).
      const lastTimestamp = lastExec
        ? Number(lastExec.ledgerTimestamp)
        : Number(sub.ledgerTimestamp);

      const secondsSinceLast = nowSec - lastTimestamp;

      // Minimum interval per contract is 86400 seconds (1 day)
      if (secondsSinceLast >= 86400) {
        due.push({ subscriber: sub.subscriber, merchant: sub.merchant });
      }
    }

    return due;
  }

  /** Build, simulate, and submit an execute_payment transaction. */
  private async executePayment(subscriber: string, merchant: string): Promise<string> {
    const account = await this.server.getAccount(this.operatorKeypair.publicKey());
    const contract = new Contract(this.contractId);

    const subscriberScVal = new Address(subscriber).toScVal();
    const merchantScVal = new Address(merchant).toScVal();

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('execute_payment', subscriberScVal, merchantScVal))
      .setTimeout(30)
      .build();

    // Simulate first to get auth entries and resource footprint
    const simResult = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      throw new Error(`Simulation failed: ${simResult.error}`);
    }

    const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(this.operatorKeypair);

    const sendResult = await this.server.sendTransaction(preparedTx);
    if (sendResult.status === 'ERROR') {
      throw new Error(`Send failed: ${JSON.stringify(sendResult.errorResult)}`);
    }

    // Poll for confirmation
    const txHash = sendResult.hash;
    for (let i = 0; i < 20; i++) {
      await sleep(1500);
      const status = await this.server.getTransaction(txHash);
      if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return txHash;
      if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`Transaction failed on-chain: ${txHash}`);
      }
    }
    throw new Error(`Transaction ${txHash} not confirmed after 30 s`);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
