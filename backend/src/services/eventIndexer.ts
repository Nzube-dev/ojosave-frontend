import { SorobanRpc, xdr } from '@stellar/stellar-sdk';
import prisma from '../lib/prisma';

export class EventIndexer {
  private rpcUrl: string;
  private contractId: string;
  private server: SorobanRpc.Server;

  constructor(rpcUrl: string, contractId: string) {
    this.rpcUrl = rpcUrl;
    this.contractId = contractId;
    this.server = new SorobanRpc.Server(rpcUrl);
  }

  async fetchAndStoreEvents(startLedger?: number): Promise<void> {
    try {
      let events: SorobanRpc.GetEventsResponse = {
        events: [],
        latestLedger: 0,
      };

      // Fetch events for the contract
      const eventsResponse = await this.server.getEvents({
        startLedger: startLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [this.contractId],
          },
        ],
        limit: 100,
      });

      events = eventsResponse;

      if (!events.events || events.events.length === 0) {
        console.log('No new events found');
        return;
      }

      console.log(`Found ${events.events.length} events`);

      // Process and store events
      for (const event of events.events) {
        await this.processEvent(event);
      }

      console.log('Events processed successfully');
    } catch (error) {
      console.error('Error fetching events:', error);
    }
  }

  private async processEvent(event: SorobanRpc.RawEvent): Promise<void> {
    try {
      // Parse the event topics and value
      const topics = event.topic;
      const value = event.value;

      if (!topics || topics.length < 4) {
        return; // Skip invalid events
      }

      const eventTypeSymbol = xdr.ScVal.fromXDR(topics[0], 'base64');
      const eventType = eventTypeSymbol.sym().toString();

      const subscriberScVal = xdr.ScVal.fromXDR(topics[1], 'base64');
      const subscriber = subscriberScVal.address().toString();

      const merchantScVal = xdr.ScVal.fromXDR(topics[2], 'base64');
      const merchant = merchantScVal.address().toString();

      const tokenScVal = xdr.ScVal.fromXDR(topics[3], 'base64');
      const token = tokenScVal.address().toString();

      const amountScVal = xdr.ScVal.fromXDR(value, 'base64');
      let amount: string;
      try {
        amount = amountScVal.i128().toString();
      } catch (e) {
        // If it's not i128, try u64
        amount = amountScVal.u64().toString();
      }

      // Check if event already exists
      const existingEvent = await prisma.event.findFirst({
        where: {
          type: eventType,
          subscriber: subscriber,
          merchant: merchant,
          token: token,
          amount: amount,
          ledgerTimestamp: BigInt(event.ledger),
        },
      });

      if (existingEvent) {
        return; // Skip duplicate
      }

      // Store the event
      await prisma.event.create({
        data: {
          type: eventType,
          subscriber: subscriber,
          merchant: merchant,
          token: token,
          amount: amount,
          ledgerTimestamp: BigInt(event.ledger),
        },
      });

      console.log(`Stored event: ${eventType} for merchant ${merchant}`);
    } catch (error) {
      console.error('Error processing event:', error);
    }
  }
}
