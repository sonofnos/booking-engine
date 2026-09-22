import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { SettlementRecord } from './entities/settlement-record.entity';
import { Payment } from '../payments/entities/payment.entity';

export interface SettlementLine {
  processorReference: string;
  amountMinorText: string;
  currency: string;
  processorStatus: string;
}

export type BreakType = 'MATCHED' | 'AMOUNT_MISMATCH' | 'MISSING_IN_LEDGER' | 'MISSING_AT_PROCESSOR';

export interface ReconciliationLine {
  processorReference: string;
  status: BreakType;
  ledgerAmountMinor: string | null;
  processorAmountMinor: string | null;
}

@Injectable()
export class ReconciliationService {
  constructor(private readonly dataSource: DataSource) {}

  /** Stages a settlement file's lines exactly as received -- untrusted text, not yet compared against anything. */
  async loadSettlementBatch(lines: SettlementLine[]): Promise<{ batchId: string; loaded: number }> {
    const batchId = randomUUID();
    const repo = this.dataSource.getRepository(SettlementRecord);
    await repo.save(lines.map((l) => repo.create({ batchId, ...l })));
    return { batchId, loaded: lines.length };
  }

  /**
   * Compares each staged settlement line against our own payment records by
   * processor reference (the one identifier both sides agree on) and
   * classifies every mismatch. This is the daily reconciliation report an
   * operations team works from: it should never require someone to eyeball
   * two spreadsheets side by side.
   */
  async reconcile(batchId: string): Promise<ReconciliationLine[]> {
    const staged = await this.dataSource.getRepository(SettlementRecord).find({ where: { batchId } });
    const results: ReconciliationLine[] = [];
    const seenRefs = new Set<string>();

    for (const line of staged) {
      seenRefs.add(line.processorReference);
      const payment = await this.dataSource.getRepository(Payment).findOne({ where: { processorReference: line.processorReference } });

      if (!payment) {
        results.push({ processorReference: line.processorReference, status: 'MISSING_IN_LEDGER', ledgerAmountMinor: null, processorAmountMinor: line.amountMinorText });
        continue;
      }
      if (payment.amountMinor !== line.amountMinorText) {
        results.push({ processorReference: line.processorReference, status: 'AMOUNT_MISMATCH', ledgerAmountMinor: payment.amountMinor, processorAmountMinor: line.amountMinorText });
        continue;
      }
      results.push({ processorReference: line.processorReference, status: 'MATCHED', ledgerAmountMinor: payment.amountMinor, processorAmountMinor: line.amountMinorText });
    }

    // Payments we have that the processor's file never mentioned at all --
    // as much a break as a mismatch, and the direction most people forget
    // to check because it isn't in the file to notice.
    const allCaptures = await this.dataSource.getRepository(Payment).find();
    for (const payment of allCaptures) {
      if (payment.processorReference && !seenRefs.has(payment.processorReference)) {
        results.push({ processorReference: payment.processorReference, status: 'MISSING_AT_PROCESSOR', ledgerAmountMinor: payment.amountMinor, processorAmountMinor: null });
      }
    }

    return results;
  }
}
