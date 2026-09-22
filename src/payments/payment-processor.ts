import { Injectable, Logger } from '@nestjs/common';

export interface ProcessorResult {
  processorReference: string;
}

export class ProcessorDeclinedError extends Error {}

/**
 * The seam to a real payment processor (Stripe, a card acquirer, a travel-
 * specific payment gateway). A fake by default for the same reason GdsClient
 * is: this repo has to run and be testable with no external account.
 */
export abstract class PaymentProcessor {
  abstract capture(amountMinor: bigint, currency: string, idempotencyKey: string): Promise<ProcessorResult>;
  abstract refund(processorReference: string, amountMinor: bigint, idempotencyKey: string): Promise<ProcessorResult>;
}

@Injectable()
export class FakePaymentProcessor extends PaymentProcessor {
  private readonly logger = new Logger(FakePaymentProcessor.name);
  private declineNext = false;

  queueDecline(): void {
    this.declineNext = true;
  }

  async capture(amountMinor: bigint, currency: string): Promise<ProcessorResult> {
    if (this.declineNext) {
      this.declineNext = false;
      throw new ProcessorDeclinedError('card declined');
    }
    this.logger.log(`captured ${amountMinor} ${currency}`);
    return { processorReference: `CAP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  }

  async refund(processorReference: string, amountMinor: bigint): Promise<ProcessorResult> {
    this.logger.log(`refunded ${amountMinor} against ${processorReference}`);
    return { processorReference: `REF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  }
}
