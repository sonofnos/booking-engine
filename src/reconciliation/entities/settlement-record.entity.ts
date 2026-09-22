import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One line from a payment processor's daily settlement file, staged as-is
 * (text columns) before validation -- the file is untrusted input until
 * ReconciliationService says otherwise.
 */
@Entity('settlement_records')
export class SettlementRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  batchId: string;

  @Column()
  processorReference: string;

  @Column()
  amountMinorText: string;

  @Column()
  currency: string;

  @Column()
  processorStatus: string;

  @CreateDateColumn()
  loadedAt: Date;
}
