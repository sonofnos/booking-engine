import { IsInt, IsPositive, IsString } from 'class-validator';

export class CreateBookingDto {
  @IsString()
  inventoryItemId: string;

  @IsString()
  customerRef: string;

  @IsInt()
  @IsPositive()
  units: number;
}
