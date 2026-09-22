import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { Booking } from './entities/booking.entity';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { BookingsExpiryTask } from './bookings-expiry.task';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentsModule } from '../payments/payments.module';
import { GdsModule } from '../gds/gds.module';

@Module({
  imports: [TypeOrmModule.forFeature([Booking]), ScheduleModule.forRoot(), InventoryModule, PaymentsModule, GdsModule],
  providers: [BookingsService, BookingsExpiryTask],
  controllers: [BookingsController],
  exports: [BookingsService],
})
export class BookingsModule {}
