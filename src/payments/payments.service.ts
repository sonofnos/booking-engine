import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { PaymentProcessor, ProcessorDeclinedError } from './payment-processor';
import { IdempotencyConflictError, PaymentDeclinedError } from '../common/errors';

@Injectable()
export class PaymentsService {
  constructor(private readonly processor: PaymentProcessor) {}

  /**
   * Idempotent on (bookingId, kind, idempotencyKey): a retried capture with
   * the same key returns the original result without calling the processor
   * again. A caller that reuses a key for a *different* amount gets a
   * conflict rather than a silently wrong charge.
   */
  async capture(manager: EntityManager, bookingId: string, amountMinor: bigint, currency: string, idempotencyKey: string): Promise<Payment> {
    const existing = await manager.findOne(Payment, { where: { bookingId, kind: 'CAPTURE', idempotencyKey } });
    if (existing) {
      if (existing.amountMinor !== amountMinor.toString()) throw new IdempotencyConflictError(idempotencyKey);
      return existing;
    }

    try {
      const result = await this.processor.capture(amountMinor, currency, idempotencyKey);
      const payment = manager.create(Payment, {
        bookingId,
        kind: 'CAPTURE',
        amountMinor: amountMinor.toString(),
        currency,
        status: PaymentStatus.CAPTURED,
        idempotencyKey,
        processorReference: result.processorReference,
      });
      return manager.save(payment);
    } catch (err) {
      if (err instanceof ProcessorDeclinedError) {
        const payment = manager.create(Payment, {
          bookingId,
          kind: 'CAPTURE',
          amountMinor: amountMinor.toString(),
          currency,
          status: PaymentStatus.FAILED,
          idempotencyKey,
          failureReason: err.message,
        });
        await manager.save(payment);
        throw new PaymentDeclinedError(err.message);
      }
      throw err;
    }
  }

  async refund(manager: EntityManager, bookingId: string, capturePayment: Payment, idempotencyKey: string): Promise<Payment> {
    const existing = await manager.findOne(Payment, { where: { bookingId, kind: 'REFUND', idempotencyKey } });
    if (existing) return existing;

    const amount = BigInt(capturePayment.amountMinor);
    const result = await this.processor.refund(capturePayment.processorReference!, amount, idempotencyKey);
    const payment = manager.create(Payment, {
      bookingId,
      kind: 'REFUND',
      amountMinor: capturePayment.amountMinor,
      currency: capturePayment.currency,
      status: PaymentStatus.REFUNDED,
      idempotencyKey,
      processorReference: result.processorReference,
    });
    return manager.save(payment);
  }
}
