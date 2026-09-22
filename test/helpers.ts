import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { InventoryType } from '../src/inventory/entities/inventory-item.entity';

export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  return app;
}

export async function resetDb(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  await dataSource.query('TRUNCATE TABLE bookings, payments, inventory_items, settlement_records CASCADE');
}

export async function createInventory(app: INestApplication, totalUnits: number, productRef = 'BA-123'): Promise<string> {
  const dataSource = app.get(DataSource);
  const repo = dataSource.getRepository('InventoryItem');
  const item = await repo.save(repo.create({ type: InventoryType.FLIGHT_SEAT, productRef, travelDate: '2027-01-01', totalUnits }));
  return (item as any).id;
}
