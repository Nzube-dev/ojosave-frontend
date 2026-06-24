import prisma from '../lib/prisma';

export class PayoutSummaryGenerator {
  async generateDailySummaries(date?: Date): Promise<void> {
    const targetDate = date || new Date();
    const startOfDay = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      0,
      0,
      0
    );
    const endOfDay = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      23,
      59,
      59
    );

    await this.generateSummaries(startOfDay, endOfDay, 'daily');
  }

  async generateWeeklySummaries(date?: Date): Promise<void> {
    const targetDate = date || new Date();
    const day = targetDate.getDay(); // 0 = Sunday
    const startOfWeek = new Date(targetDate);
    startOfWeek.setDate(targetDate.getDate() - day);
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    await this.generateSummaries(startOfWeek, endOfWeek, 'weekly');
  }

  private async generateSummaries(
    startDate: Date,
    endDate: Date,
    type: 'daily' | 'weekly'
  ): Promise<void> {
    try {
      // Get all merchants with events in this period
      const events = await prisma.event.findMany({
        where: {
          type: 'executed',
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      if (events.length === 0) {
        console.log('No events found for the period');
        return;
      }

      // Group events by merchant and token
      const merchantTokenGroups = new Map<string, Map<string, typeof events>>();

      for (const event of events) {
        if (!merchantTokenGroups.has(event.merchant)) {
          merchantTokenGroups.set(event.merchant, new Map());
        }
        const merchantGroups = merchantTokenGroups.get(event.merchant)!;

        const token = event.token || 'unknown';
        if (!merchantGroups.has(token)) {
          merchantGroups.set(token, []);
        }
        merchantGroups.get(token)!.push(event);
      }

      // Generate summaries
      for (const [merchant, tokenGroups] of merchantTokenGroups) {
        for (const [token, merchantEvents] of tokenGroups) {
          // Calculate total amount
          let totalAmount = BigInt(0);
          for (const event of merchantEvents) {
            totalAmount += BigInt(event.amount);
          }

          // Check if summary already exists
          const existingSummary = await prisma.payoutSummary.findFirst({
            where: {
              merchant: merchant,
              startDate: startDate,
              endDate: endDate,
              type: type,
              currency: token,
            },
          });

          if (existingSummary) {
            // Update existing summary
            await prisma.payoutSummary.update({
              where: { id: existingSummary.id },
              data: {
                totalAmount: totalAmount.toString(),
                paymentCount: merchantEvents.length,
              },
            });
            console.log(`Updated ${type} summary for merchant ${merchant}`);
          } else {
            // Create new summary
            await prisma.payoutSummary.create({
              data: {
                merchant: merchant,
                startDate: startDate,
                endDate: endDate,
                type: type,
                totalAmount: totalAmount.toString(),
                paymentCount: merchantEvents.length,
                currency: token,
              },
            });
            console.log(`Created ${type} summary for merchant ${merchant}`);
          }
        }
      }
    } catch (error) {
      console.error('Error generating summaries:', error);
    }
  }
}
