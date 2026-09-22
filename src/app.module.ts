import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as pg from 'pg';
import { AppController } from './app.controller';
import { InventoryModule } from './inventory/inventory.module';
import { BookingsModule } from './bookings/bookings.module';
import { PaymentsModule } from './payments/payments.module';
import { GdsModule } from './gds/gds.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { InventoryItem } from './inventory/entities/inventory-item.entity';
import { Booking } from './bookings/entities/booking.entity';
import { Payment } from './payments/entities/payment.entity';
import { SettlementRecord } from './reconciliation/entities/settlement-record.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        // Passed explicitly rather than left for TypeORM's internal
        // PlatformTools.load('pg') to resolve dynamically: under ts-jest on
        // this Node version, that dynamic require picks up pg's dual
        // ESM/CJS export map incorrectly and hands TypeORM a Pool that
        // isn't constructible ("this.postgres.Pool is not a constructor"),
        // even though `import * as pg from 'pg'` at the top of this file
        // resolves the exact same package correctly. Supplying the driver
        // directly is TypeORM's documented escape hatch for this.
        driver: pg,
        host: config.get('DB_HOST', 'localhost'),
        port: config.get('DB_PORT', 5438),
        username: config.get('DB_USERNAME', 'booking'),
        password: config.get('DB_PASSWORD', 'booking'),
        database: config.get('DB_NAME', 'booking_engine'),
        entities: [InventoryItem, Booking, Payment, SettlementRecord],
        // synchronize:true is fine for this demo repo; a production service
        // would use hand-written migrations, the same way ledger-api does.
        synchronize: true,
        // Default pool size (10) starves under many concurrent holds on the
        // same row -- requests queue for a connection *and* for the row
        // lock at once, which is what turned a should-be-simple queue into
        // socket timeouts in testing.
        extra: { max: 30 },
      }),
    }),
    InventoryModule,
    BookingsModule,
    PaymentsModule,
    GdsModule,
    ReconciliationModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
