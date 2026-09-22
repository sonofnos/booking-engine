import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createInventory, createTestApp, resetDb } from './helpers';

describe('Reconciliation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => app.close());
  beforeEach(async () => resetDb(app));

  it('classifies matched, mismatched, missing-in-ledger and missing-at-processor lines', async () => {
    const inventoryItemId = await createInventory(app, 5);

    async function confirmedBooking(units: number, amountMinor: number) {
      const held = await request(app.getHttpServer()).post('/bookings').send({ inventoryItemId, customerRef: 'x', units });
      const confirmed = await request(app.getHttpServer())
        .post(`/bookings/${held.body.id}/confirm`)
        .send({ amountMinor, currency: 'USD', idempotencyKey: randomUUID() });
      return confirmed.body;
    }

    const matched = await confirmedBooking(1, 50000);
    const mismatched = await confirmedBooking(1, 30000);

    const dataSource = app.get(DataSource);
    const matchedPayment = await dataSource.getRepository('Payment').findOne({ where: { bookingId: matched.id, kind: 'CAPTURE' } });
    const mismatchedPayment = await dataSource.getRepository('Payment').findOne({ where: { bookingId: mismatched.id, kind: 'CAPTURE' } });

    const batch = await request(app.getHttpServer())
      .post('/reconciliation/batches')
      .send({
        lines: [
          { processorReference: (matchedPayment as any).processorReference, amountMinorText: '50000', currency: 'USD', processorStatus: 'SETTLED' },
          { processorReference: (mismatchedPayment as any).processorReference, amountMinorText: '29999', currency: 'USD', processorStatus: 'SETTLED' },
          { processorReference: 'PROC-DOES-NOT-EXIST', amountMinorText: '1000', currency: 'USD', processorStatus: 'SETTLED' },
        ],
      })
      .expect(201);

    const report = await request(app.getHttpServer()).get(`/reconciliation/batches/${batch.body.batchId}/report`).expect(200);
    const byRef: Record<string, string> = Object.fromEntries(report.body.map((l: any) => [l.processorReference, l.status]));

    expect(byRef[(matchedPayment as any).processorReference]).toBe('MATCHED');
    expect(byRef[(mismatchedPayment as any).processorReference]).toBe('AMOUNT_MISMATCH');
    expect(byRef['PROC-DOES-NOT-EXIST']).toBe('MISSING_IN_LEDGER');
  });

  it('flags a captured payment that never appeared in the settlement file at all', async () => {
    const inventoryItemId = await createInventory(app, 5);
    const held = await request(app.getHttpServer()).post('/bookings').send({ inventoryItemId, customerRef: 'x', units: 1 });
    const confirmed = await request(app.getHttpServer())
      .post(`/bookings/${held.body.id}/confirm`)
      .send({ amountMinor: 50000, currency: 'USD', idempotencyKey: randomUUID() });

    const batch = await request(app.getHttpServer()).post('/reconciliation/batches').send({ lines: [] }).expect(201);
    const report = await request(app.getHttpServer()).get(`/reconciliation/batches/${batch.body.batchId}/report`).expect(200);

    const dataSource = app.get(DataSource);
    const payment = await dataSource.getRepository('Payment').findOne({ where: { bookingId: confirmed.body.id, kind: 'CAPTURE' } });
    const line = report.body.find((l: any) => l.processorReference === (payment as any).processorReference);
    expect(line.status).toBe('MISSING_AT_PROCESSOR');
  });
});
