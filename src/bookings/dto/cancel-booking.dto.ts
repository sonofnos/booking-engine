import { IsOptional, IsString } from 'class-validator';

export class CancelBookingDto {
  @IsString()
  idempotencyKey: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
