import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { FakeGdsClient, GdsClient } from '../src/gds/gds-client';
import { FakePaymentProcessor, PaymentProcessor } from '../src/payments/payment-processor';
import { createInventory, createTestApp, resetDb } from './helpers';

describe('Booking lifecycle (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => app.close());
  beforeEach(async () => resetDb(app));

  it('holds, confirms with payment and a GDS reference, then cancels with a refund', async () => {
    const inventoryItemId = await createInventory(app, 5);

    const held = await request(app.getHttpServer()).post('/bookings').send({ inventoryItemId, customerRef: 'alice', units: 1 }).expect(201);
    expect(held.body.status).toBe('HELD');

    const confirmed = await request(app.getHttpServer())
      .post(`/bookings/${held.body.id}/confirm`)
      .send({ amountMinor: 50000, currency: 'USD', idempotencyKey: randomUUID() })
      .expect(201);
    expect(confirmed.body.status).toBe('CONFIRMED');
    expect(confirmed.body.gdsReference).toMatch(/^PNR-/);

    const dataSource = app.get(DataSource);
    const itemAfterConfirm = await dataSource.getRepository('InventoryItem').findOne({ where: { id: inventoryItemId } });
    expect((itemAfterConfirm as any).heldUnits).toBe(0);
    expect((itemAfterConfirm as any).bookedUnits).toBe(1);

    const cancelled = await request(app.getHttpServer())
      .post(`/bookings/${held.body.id}/cancel`)
      .send({ idempotencyKey: randomUUID(), reason: 'customer request' })
      .expect(201);
    expect(cancelled.body.status).toBe('CANCELLED');

    const payments = await dataSource.getRepository('Payment').find({ where: { bookingId: held.body.id } });
    expect(payments.map((p: any) => p.kind).sort()).toEqual(['CAPTURE', 'REFUND']);

    const itemAfterCancel = await dataSource.getRepository('InventoryItem').findOne({ where: { id: inventoryItemId } });
    expect((itemAfterCancel as any).bookedUnits).toBe(0);
  });

  it('cancelling a HELD (unconfirmed) booking releases the hold and takes no payment', async () => {
    const inventoryItemId = await createInventory(app, 5);
    const held = await request(app.getHttpServer()).post('/bookings').send({ inventoryItemId, customerRef: 'alice', units: 2 }).expect(201);

    await request(app.getHttpServer()).post(`/bookings/${held.body.id}/cancel`).send({ idempotencyKey: randomUUID() }).expect(201);

    const dataSource = app.get(DataSource);
    const item = await dataSource.getRepository('InventoryItem').findOne({ where: { id: inventoryItemId } });
    expect((item as any).heldUnits).toBe(0);
    const payments = await dataSource.getRepository('Payment').find({ where: { bookingId: held.body.id } });
    expect(payments).toHaveLength(0);
  });

  it('confirming an already-confirmed booking is rejected by the state guard', async () => {
    const inventoryItemId = await createInventory(app, 5);
    const held = await request(app.getHttpServer()).post('/bookings').send({ inventoryItemId, customerRef: 'alice', units: 1 }).expect(201);
    const key = randomUUID();

    await request(app.getHttpServer()).post(`/bookings/${held.body.id}/confirm`).send({ amountMinor: 50000, currency: 'USD', idempotencyKey: key }).expect(201);
    // A second confirm call hits the state guard (booking is CONFIRMED, not HELD) before payment idempotency is even consulted.
    const second = await request(app.getHttpServer()).post(`/bookings/${held.body.id}/confirm`).send({ amountMinor: 50000, currency: 'USD', idempotencyKey: key });
    expect(second.status).toBe(409);

    const dataSource = app.get(DataSource);
    const payments = await dataSource.getRepository('Payment').find({ where: { bookingId: held.body.id, kind: 'CAPTURE' } });
    expect(payments).toHaveLength(1); // only ever captured once
  });

  it('a declined card leaves the booking HELD, not CONFIRMED, and inventory is not converted', async () => {
    const inventoryItemId = await createInventory(app, 5);
    const held = await request(app.getHttpServer()).post('/bookings').send({ inventoryItemId, customerRef: 'alice', units: 1 }).expect(201);

    const processor = app.get(PaymentProcessor) as FakePaymentProcessor;
    processor.queueDecline();

    await request(app.getHttpServer()).post(`/bookings/${held.body.id}/confirm`).send({ amountMinor: 50000, currency: 'USD', idempotencyKey: randomUUID() }).expect(422);

    const fresh = await request(app.getHttpServer()).get(`/bookings/${held.body.id}`).expect(200);
    expect(fresh.body.status).toBe('HELD');

    const dataSource = app.get(DataSource);
    const item = await dataSource.getRepository('InventoryItem').findOne({ where: { id: inventoryItemId } });
    expect((item as any).heldUnits).toBe(1); // still held, not booked, not released
  });

  it('a GDS failure after successful capture leaves the payment captured and the booking HELD for an operator to resolve', async () => {
    const inventoryItemId = await createInventory(app, 5);
    const held = await request(app.getHttpServer()).post('/bookings').send({ inventoryItemId, customerRef: 'alice', units: 1 }).expect(201);

    const gds = app.get(GdsClient) as FakeGdsClient;
    gds.queueFailure('unavailable');

    await request(app.getHttpServer()).post(`/bookings/${held.body.id}/confirm`).send({ amountMinor: 50000, currency: 'USD', idempotencyKey: randomUUID() }).expect(500);

    const dataSource = app.get(DataSource);
    const fresh = await dataSource.getRepository('Booking').findOne({ where: { id: held.body.id } });
    expect((fresh as any).status).toBe('HELD');
    const payments = await dataSource.getRepository('Payment').find({ where: { bookingId: held.body.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('CAPTURED'); // the capture is not rolled back or auto-refunded
  });
});
