import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Booking, BookingStatus } from './entities/booking.entity';
import { Payment } from '../payments/entities/payment.entity';
import { InventoryService } from '../inventory/inventory.service';
import { PaymentsService } from '../payments/payments.service';
import { GdsClient, GdsError } from '../gds/gds-client';
import { BookingNotFoundError, InvalidBookingStateError } from '../common/errors';
import { withDeadlockRetry } from '../common/retry-transaction';

const HOLD_TTL_MINUTES = 15;

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly inventoryService: InventoryService,
    private readonly paymentsService: PaymentsService,
    private readonly gdsClient: GdsClient,
  ) {}

  /** Places a hold: locks inventory and reserves units, but takes no payment and calls no GDS. */
  async createHold(input: { inventoryItemId: string; customerRef: string; units: number }): Promise<Booking> {
    return withDeadlockRetry(() =>
      this.dataSource.transaction(async (manager) => {
        await this.inventoryService.holdUnits(manager, input.inventoryItemId, input.units);
        const booking = manager.create(Booking, {
          inventoryItemId: input.inventoryItemId,
          customerRef: input.customerRef,
          units: input.units,
          status: BookingStatus.HELD,
          holdExpiresAt: new Date(Date.now() + HOLD_TTL_MINUTES * 60_000),
        });
        return manager.save(booking);
      }),
    );
  }

  async get(id: string): Promise<Booking> {
    const booking = await this.dataSource.getRepository(Booking).findOne({ where: { id } });
    if (!booking) throw new BookingNotFoundError(id);
    return booking;
  }

  /**
   * Confirms a HELD booking: capture payment, then confirm with the GDS.
   * Order matters -- payment first, because a GDS confirmation that
   * succeeds after a declined card would sell a seat/room nobody paid for.
   * If the GDS call fails *after* a successful capture, the booking is
   * rolled back to HELD (not lost, not silently CONFIRMED) and the payment
   * that was captured stays captured -- see the comment inline for why a
   * refund isn't fired automatically here.
   */
  /**
   * Confirms a HELD booking in two independent transactions, not one --
   * this is deliberate, and the first version of this method got it wrong.
   *
   * Putting payment capture and GDS confirmation inside a single
   * `dataSource.transaction()` looks natural, but it means a GDS failure
   * throws inside that callback and rolls back *everything*, including the
   * payment capture that already succeeded. That silently un-captures a
   * real charge the moment the GDS has a bad day -- the opposite of what a
   * financial system should do. The fix is to let the capture commit on its
   * own before the GDS is ever called, so a GDS failure afterward can only
   * affect the booking/inventory transaction, never the money that already
   * moved.
   */
  async confirm(bookingId: string, input: { amountMinor: number; currency: string; idempotencyKey: string }): Promise<Booking> {
    const booking = await this.get(bookingId);
    if (booking.status !== BookingStatus.HELD) throw new InvalidBookingStateError(booking.status, 'confirm');
    if (booking.holdExpiresAt.getTime() < Date.now()) throw new InvalidBookingStateError('EXPIRED', 'confirm');

    // Phase 1: capture payment and commit. Idempotent on idempotencyKey.
    await this.dataSource.transaction((manager) => this.paymentsService.capture(manager, bookingId, BigInt(input.amountMinor), input.currency, input.idempotencyKey));

    // Phase 2: confirm with the GDS, then convert the hold. If this fails,
    // the capture from phase 1 is already committed and stays that way --
    // an operator sees this booking stuck at HELD with a captured payment
    // and decides whether to retry the GDS call or refund and release the
    // hold by hand. Auto-refunding here would hide a real operational
    // problem (the GDS is down, or rejected a fare that's no longer valid)
    // behind a refund that looks like nothing happened.
    try {
      const gdsResult = await this.gdsClient.confirmBooking({
        bookingId,
        productRef: booking.inventoryItemId,
        travelDate: '', // resolved from inventory in a fuller version; omitted here to keep the fake client simple
        units: booking.units,
      });
      return this.dataSource.transaction(async (manager) => {
        await this.inventoryService.convertHoldToBooked(manager, booking.inventoryItemId, booking.units);
        booking.status = BookingStatus.CONFIRMED;
        booking.gdsReference = gdsResult.pnr;
        return manager.save(booking);
      });
    } catch (err) {
      if (err instanceof GdsError) {
        this.logger.error(`GDS confirmation failed for booking ${bookingId} after successful capture: ${err.message}`);
      }
      throw err;
    }
  }

  /** Cancels a HELD or CONFIRMED booking. A CONFIRMED cancellation refunds the capture and releases booked inventory; a HELD cancellation just releases the hold. */
  async cancel(bookingId: string, input: { idempotencyKey: string; reason?: string }): Promise<Booking> {
    return this.dataSource.transaction(async (manager) => {
      const booking = await manager.findOne(Booking, { where: { id: bookingId } });
      if (!booking) throw new BookingNotFoundError(bookingId);
      if (booking.status !== BookingStatus.HELD && booking.status !== BookingStatus.CONFIRMED) {
        throw new InvalidBookingStateError(booking.status, 'cancel');
      }

      if (booking.status === BookingStatus.CONFIRMED) {
        const capture = await manager.findOne(Payment, { where: { bookingId, kind: 'CAPTURE' } });
        if (capture && capture.status === 'CAPTURED') {
          await this.paymentsService.refund(manager, bookingId, capture, input.idempotencyKey);
        }
        if (booking.gdsReference) {
          await this.gdsClient.cancelBooking(booking.gdsReference);
        }
        await this.inventoryService.releaseBooked(manager, booking.inventoryItemId, booking.units);
      } else {
        await this.inventoryService.releaseHeld(manager, booking.inventoryItemId, booking.units);
      }

      booking.status = BookingStatus.CANCELLED;
      booking.cancellationReason = input.reason ?? null;
      return manager.save(booking);
    });
  }

  /** Called on a schedule (see BookingsExpiryTask). Releases inventory for holds nobody confirmed in time. */
  async expireOverdueHolds(): Promise<number> {
    const overdue = await this.dataSource.getRepository(Booking).find({ where: { status: BookingStatus.HELD } });
    let expired = 0;
    for (const booking of overdue) {
      if (booking.holdExpiresAt.getTime() >= Date.now()) continue;
      await this.dataSource.transaction(async (manager) => {
        await this.inventoryService.releaseHeld(manager, booking.inventoryItemId, booking.units);
        booking.status = BookingStatus.EXPIRED;
        await manager.save(booking);
      });
      expired++;
    }
    return expired;
  }
}
