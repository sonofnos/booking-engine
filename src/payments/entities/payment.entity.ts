import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum PaymentStatus {
  CAPTURED = 'CAPTURED',
  REFUNDED = 'REFUNDED',
  FAILED = 'FAILED',
}

/**
 * One row per capture or refund, not one row per booking -- a booking that's
 * captured then partially refunded has two payment rows, both readable, so
 * the money history is never overwritten in place.
 */
@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  bookingId: string;

  @Column({ type: 'enum', enum: ['CAPTURE', 'REFUND'] })
  kind: 'CAPTURE' | 'REFUND';

  @Column({ type: 'bigint' })
  amountMinor: string;

  @Column({ length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'enum', enum: PaymentStatus })
  status: PaymentStatus;

  // The idempotency key the caller supplied, unique per booking+kind so a
  // retried capture or refund request cannot double-charge or double-refund.
  @Column()
  idempotencyKey: string;

  @Column({ type: 'varchar', nullable: true })
  processorReference: string | null;

  @Column({ type: 'varchar', nullable: true })
  failureReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
