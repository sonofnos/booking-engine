import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn, VersionColumn } from 'typeorm';

export enum InventoryType {
  FLIGHT_SEAT = 'FLIGHT_SEAT',
  HOTEL_ROOM = 'HOTEL_ROOM',
}

/**
 * One bookable unit for one date/departure -- a fare class on a flight
 * number/date, or a room type on a hotel/date. `totalUnits` is fixed at
 * creation; `heldUnits` and `bookedUnits` move as reservations progress.
 * Available capacity is always `totalUnits - heldUnits - bookedUnits`,
 * computed, never stored, so it cannot drift out of sync with the ledger of
 * holds and bookings that produced it.
 */
@Entity('inventory_items')
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: InventoryType })
  type: InventoryType;

  @Column()
  productRef: string; // flight number or hotel/room-type code

  @Column({ type: 'date' })
  travelDate: string;

  @Column({ type: 'int' })
  totalUnits: number;

  @Column({ type: 'int', default: 0 })
  heldUnits: number;

  @Column({ type: 'int', default: 0 })
  bookedUnits: number;

  // Optimistic-lock backstop behind the pessimistic row lock the posting
  // path takes explicitly -- see InventoryService.reserve.
  @VersionColumn()
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
