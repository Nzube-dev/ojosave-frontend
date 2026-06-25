import prisma from '../lib/prisma';

export interface AuditLogData {
  eventType: string;
  subscriber: string;
  merchant: string;
  token: string;
  amount: string;
  transactionHash: string;
  ledger: bigint;
}

export class AuditLogger {
  async logPayment(data: AuditLogData): Promise<void> {
    await prisma.auditLog.upsert({
      where: { transactionHash: data.transactionHash },
      update: {},
      create: data,
    });
  }
}
