import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingsService } from './bookings.service';

@Injectable()
export class BookingsExpiryTask {
  private readonly logger = new Logger(BookingsExpiryTask.name);

  constructor(private readonly bookingsService: BookingsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handle(): Promise<void> {
    const expired = await this.bookingsService.expireOverdueHolds();
    if (expired > 0) this.logger.log(`expired ${expired} overdue hold(s)`);
  }
}
