import { IsInt, IsPositive, IsString } from 'class-validator';

export class ConfirmBookingDto {
  @IsInt()
  @IsPositive()
  amountMinor: number;

  @IsString()
  currency: string;

  @IsString()
  idempotencyKey: string;
}
