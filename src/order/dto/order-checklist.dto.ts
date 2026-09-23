import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class OrderChecklistDto {
  @ApiProperty({ format: 'uuid' })
  orderId: string;

  @ApiProperty({ description: 'Harvest / collect' })
  harvested: boolean;

  @ApiProperty({ description: 'Sort' })
  sorted: boolean;

  @ApiProperty({ description: 'Package' })
  packaged: boolean;

  @ApiProperty({ description: 'Ready for pickup' })
  readyForPickup: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/** Tick or untick any subset of items; omitted items are left as they are. */
export class UpdateOrderChecklistDto {
  @ApiPropertyOptional({ description: 'Harvest / collect' })
  @IsOptional()
  @IsBoolean()
  harvested?: boolean;

  @ApiPropertyOptional({ description: 'Sort' })
  @IsOptional()
  @IsBoolean()
  sorted?: boolean;

  @ApiPropertyOptional({ description: 'Package' })
  @IsOptional()
  @IsBoolean()
  packaged?: boolean;

  @ApiPropertyOptional({ description: 'Ready for pickup' })
  @IsOptional()
  @IsBoolean()
  readyForPickup?: boolean;
}
