import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createInventory, createTestApp, resetDb } from './helpers';

/**
 * The test that matters most for this domain. Twenty customers try to hold
 * the last ten seats on the same flight, simultaneously. Exactly ten holds
 * may succeed; the other ten must be refused as insufficient inventory, not
 * silently oversold. This is the airline/hotel equivalent of a bank
 * overdraft check under concurrency, and it fails the same way if a
 * check-then-act race is left in the code: read available seats, see 10,
 * let all twenty requests through because none of them re-read before
 * writing.
 */
describe('Concurrent holds (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => app.close());
  beforeEach(async () => resetDb(app));

  it('oversells nothing when many holds race for the same limited inventory', async () => {
    const inventoryItemId = await createInventory(app, 10);
    const attempts = 20;

    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) =>
        request(app.getHttpServer())
          .post('/bookings')
          .send({ inventoryItemId, customerRef: `customer-${i}`, units: 1 })
          .then((res: request.Response) => res.status),
      ),
    );

    const succeeded = results.filter((s: number) => s === 201).length;
    const rejected = results.filter((s: number) => s === 422).length;
    expect(succeeded).toBe(10);
    expect(rejected).toBe(10);

    const dataSource = app.get(DataSource);
    const item = await dataSource.getRepository('InventoryItem').findOne({ where: { id: inventoryItemId } });
    expect((item as any).heldUnits).toBe(10);
    expect((item as any).totalUnits - (item as any).heldUnits - (item as any).bookedUnits).toBe(0);
  }, 20000);

  it('a multi-unit request that would oversell is refused even when units are individually available', async () => {
    const inventoryItemId = await createInventory(app, 5);
    // Two requests for 3 units each: the second must fail (only 2 left), not partially succeed.
    const first = await request(app.getHttpServer()).post('/bookings').send({ inventoryItemId, customerRef: 'a', units: 3 });
    const second = await request(app.getHttpServer()).post('/bookings').send({ inventoryItemId, customerRef: 'b', units: 3 });

    expect(first.status).toBe(201);
    expect(second.status).toBe(422);
  });
});
