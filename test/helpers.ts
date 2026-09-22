import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { InventoryType } from '../src/inventory/entities/inventory-item.entity';
import { withDeadlockRetry } from '../src/common/retry-transaction';

export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  return app;
}

export async function resetDb(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  // TRUNCATE takes an ACCESS EXCLUSIVE lock; on a slow CI runner it can run
  // immediately after the previous test's burst-concurrency requests, some
  // of which may still be finishing a rollback and briefly holding a row
  // lock of their own. Same retry-on-deadlock policy as the app itself uses.
  await withDeadlockRetry(() => dataSource.query('TRUNCATE TABLE bookings, payments, inventory_items, settlement_records CASCADE'));
}

export async function createInventory(app: INestApplication, totalUnits: number, productRef = 'BA-123'): Promise<string> {
  const dataSource = app.get(DataSource);
  const repo = dataSource.getRepository('InventoryItem');
  const item = await repo.save(repo.create({ type: InventoryType.FLIGHT_SEAT, productRef, travelDate: '2027-01-01', totalUnits }));
  return (item as any).id;
}
