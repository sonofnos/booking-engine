import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentsService } from './payments.service';
import { FakePaymentProcessor, PaymentProcessor } from './payment-processor';

@Module({
  imports: [TypeOrmModule.forFeature([Payment])],
  providers: [PaymentsService, { provide: PaymentProcessor, useClass: FakePaymentProcessor }],
  exports: [PaymentsService, PaymentProcessor],
})
export class PaymentsModule {}
