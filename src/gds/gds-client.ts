import { Injectable, Logger } from '@nestjs/common';

export interface GdsConfirmRequest {
  bookingId: string;
  productRef: string;
  travelDate: string;
  units: number;
}

export interface GdsConfirmResult {
  pnr: string;
}

export class GdsError extends Error {}
export class GdsUnavailableError extends GdsError {}
export class GdsRejectedError extends GdsError {}

/**
 * The seam between this service and whatever real GDS/airline or hotel
 * supplier API sits behind it (Amadeus, Sabre, Travelport, a hotel
 * aggregator). Everything downstream depends on this interface, not on a
 * specific vendor SDK, so swapping the vendor is a new implementation of
 * this class, not a rewrite of the booking flow.
 */
export abstract class GdsClient {
  abstract confirmBooking(req: GdsConfirmRequest): Promise<GdsConfirmResult>;
  abstract cancelBooking(pnr: string): Promise<void>;
}

/**
 * A dependency-free stand-in so this repo runs and is testable without a
 * real GDS contract or API keys. `failNextConfirm`/`unavailableNextConfirm`
 * exist purely for tests to exercise the retry and failure paths in
 * BookingsService without needing a flaky real dependency to reproduce them.
 */
@Injectable()
export class FakeGdsClient extends GdsClient {
  private readonly logger = new Logger(FakeGdsClient.name);
  private forcedFailures: ('unavailable' | 'rejected')[] = [];

  queueFailure(kind: 'unavailable' | 'rejected'): void {
    this.forcedFailures.push(kind);
  }

  async confirmBooking(req: GdsConfirmRequest): Promise<GdsConfirmResult> {
    const forced = this.forcedFailures.shift();
    if (forced === 'unavailable') throw new GdsUnavailableError('GDS temporarily unavailable');
    if (forced === 'rejected') throw new GdsRejectedError('GDS rejected the request: fare no longer valid');

    this.logger.log(`confirming ${req.units} unit(s) of ${req.productRef} on ${req.travelDate}`);
    return { pnr: `PNR-${req.bookingId.slice(0, 8).toUpperCase()}` };
  }

  async cancelBooking(pnr: string): Promise<void> {
    this.logger.log(`cancelling ${pnr}`);
  }
}
