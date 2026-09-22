import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum BookingStatus {
  HELD = 'HELD', // inventory reserved, payment not yet captured
  CONFIRMED = 'CONFIRMED', // payment captured, GDS confirmed
  CANCELLED = 'CANCELLED', // cancelled before or after confirmation
  EXPIRED = 'EXPIRED', // hold timed out before payment
}

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  inventoryItemId: string;

  @Column()
  customerRef: string;

  @Column({ type: 'int' })
  units: number;

  @Column({ type: 'enum', enum: BookingStatus, default: BookingStatus.HELD })
  status: BookingStatus;

  // Set on creation; a scheduled sweep expires any booking still HELD past this.
  @Column({ type: 'timestamptz' })
  holdExpiresAt: Date;

  // The GDS's own confirmation/PNR reference, set once ConfirmBooking succeeds.
  @Column({ type: 'varchar', nullable: true })
  gdsReference: string | null;

  @Column({ type: 'varchar', nullable: true })
  cancellationReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
