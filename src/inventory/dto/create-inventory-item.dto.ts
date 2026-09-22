import { IsDateString, IsEnum, IsInt, IsPositive, IsString } from 'class-validator';
import { InventoryType } from '../entities/inventory-item.entity';

export class CreateInventoryItemDto {
  @IsEnum(InventoryType)
  type: InventoryType;

  @IsString()
  productRef: string;

  @IsDateString()
  travelDate: string;

  @IsInt()
  @IsPositive()
  totalUnits: number;
}
