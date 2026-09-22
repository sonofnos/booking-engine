# booking-engine

A reservation and payment engine for flight- or hotel-style inventory: concurrency-safe holds, idempotent payment capture and refund, a mock GDS integration, and settlement reconciliation. NestJS, PostgreSQL, TypeORM.

Not tied to a specific airline or hotel system. The problem it demonstrates, hold inventory, take payment, confirm with an external system, and handle cancellation and refund without ever overselling or double-charging, is the same shape for a flight, a hotel room, or an event ticket, and it's the same shape as the double-entry ledgers I've built for fintech clients: money and inventory both need correctness under concurrency, and both need a paper trail an operator can reconcile.

## The concurrency story

Twenty customers try to hold the last ten seats on the same flight at once. Exactly ten holds succeed; the other ten are refused as insufficient inventory (422), not silently oversold. `InventoryService.holdUnits` locks the inventory row with `SELECT ... FOR UPDATE` before checking availability, so there is no window between reading "10 available" and writing the hold where two requests can both act on the same stale number.

Under enough concurrent lock contention on a single row, PostgreSQL's lock manager can report `deadlock detected` (40P01) even though only one resource is involved — a known behavior around tuple-lock upgrades, not a bug in the query. Postgres's own documentation says the application is expected to retry a transaction that failed this way. `src/common/retry-transaction.ts` does that: a bounded retry on 40P01 and 40001 (serialization failure) with jittered backoff, wrapped around the hold path. `retry-transaction.spec.ts` tests it in isolation; `concurrency.e2e-spec.ts` exercises it for real against Postgres with 20 simultaneous requests.

## A bug this repo actually had

The first version of `confirm()` captured payment and called the mock GDS inside one database transaction. That looks natural — it isn't. If the GDS call throws, NestJS/TypeORM rolls back the *entire* transaction, including the payment capture that had already succeeded. A GDS outage would silently un-capture a real charge.

The fix, in the current `BookingsService.confirm`, is two independent transactions: payment capture commits on its own, and only then is the GDS called. If the GDS fails, the booking stays `HELD` with a captured payment — visible to an operator, who decides whether to retry the GDS call or refund and release the hold by hand. Auto-refunding on a GDS failure would hide an operational problem behind a refund that looks like nothing happened. `booking-lifecycle.e2e-spec.ts::a GDS failure after successful capture...` is the test that would have caught the original bug, and does now.

## What else is here

- **Idempotent payments** (`PaymentsService`): capture and refund are keyed on `(bookingId, kind, idempotencyKey)`. A retried request with the same key returns the original result; the same key with a different amount is a conflict, not a silent overwrite.
- **State machine, not a status enum people forget to check**: `confirm` and `cancel` both verify the booking is in a state that action is valid for (`HELD` before confirming, `HELD` or `CONFIRMED` before cancelling) and reject anything else with a 409, before touching payment or inventory.
- **Expiry sweep** (`BookingsExpiryTask`): a scheduled job releases held inventory for holds nobody confirmed in time, so an abandoned booking flow doesn't lock a seat forever.
- **Reconciliation** (`ReconciliationService`): stages a settlement file's lines as untrusted text, then classifies each against our own payment records as matched, an amount mismatch, missing in our ledger, or — the direction people most often forget to check — a payment we have that the processor's file never mentioned.
- **GDS and payment processor behind interfaces** (`GdsClient`, `PaymentProcessor`): fakes by default, so this repo runs and is fully tested with no real GDS contract or payment gateway account. Swapping either for a real vendor is a new implementation of the interface, not a rewrite of the booking flow.

## Running it

```bash
docker compose up -d --wait      # Postgres on :5438
npm install
npm run start:dev                # :3000
```

```bash
npm test          # unit tests
npm run test:e2e  # 10 tests against real Postgres, including the concurrency and GDS-failure cases above
npm run lint
npm run typecheck
```

## Layout

```
src/inventory/       InventoryItem entity + row-locked hold/convert/release
src/bookings/        the HELD -> CONFIRMED / CANCELLED / EXPIRED state machine, the two-phase confirm
src/payments/        idempotent capture/refund behind a PaymentProcessor interface
src/gds/             GdsClient interface + fake implementation
src/reconciliation/  settlement staging + break classification
src/common/          domain errors, the deadlock-retry helper
```
