import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ProduceCategory, ProduceStatus } from '../../../generated/client';
import { PaginationQueryDto } from '../../common/pagination';

export class AdminProduceRowDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Premium Sesame Seeds' })
  name: string;

  @ApiProperty({ format: 'uuid' })
  farmId: string;

  @ApiProperty({ example: 'LF-000018' })
  farmCode: string;

  @ApiProperty({
    enum: ProduceCategory,
    enumName: 'ProduceCategory',
    nullable: true,
  })
  category: ProduceCategory | null;

  @ApiProperty({ type: String, example: '1250.00' })
  pricePerUnit: string;

  @ApiProperty({ example: 'kg' })
  unit: string;

  @ApiProperty({
    type: 'integer',
    description: 'Stock buyers can still order, in `unit`',
  })
  floatingQuantity: number;

  @ApiProperty({ enum: ProduceStatus, enumName: 'ProduceStatus' })
  status: ProduceStatus;

  @ApiProperty()
  createdAt: Date;
}

/** The cards above the products table. Not affected by the table filters. */
export class AdminProduceSummaryDto {
  @ApiProperty({ type: 'integer' })
  totalProducts: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Distinct categories actually used. Listings with no category are left out',
  })
  categoryCount: number;

  @ApiProperty({
    type: 'integer',
    description: 'Farms with at least one listing',
  })
  participatingFarms: number;

  @ApiProperty({
    type: 'integer',
    description: 'PUBLISHED and SOLD_OUT listings',
  })
  activeListings: number;

  @ApiProperty({
    type: 'integer',
    description: 'DRAFT and DISABLED listings',
  })
  inactiveListings: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Sum of floatingQuantity where the unit is kg. Other units are left out',
  })
  availableStockKg: number;

  @ApiProperty({
    type: 'integer',
    description: 'Clusters that contain a farm with a listing',
  })
  activeClusters: number;

  @ApiProperty({
    type: 'integer',
    description: 'Listings created in the last 7 days',
  })
  recentListings: number;
}

export class AdminProduceActionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ProduceStatus, enumName: 'ProduceStatus' })
  status: ProduceStatus;
}

export class AdminProduceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'sesame',
    description:
      'Case-insensitive match on the product name, farm name or farm code',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({
    enum: ProduceCategory,
    enumName: 'ProduceCategory',
  })
  @IsOptional()
  @IsEnum(ProduceCategory)
  category?: ProduceCategory;

  @ApiPropertyOptional({ enum: ProduceStatus, enumName: 'ProduceStatus' })
  @IsOptional()
  @IsEnum(ProduceStatus)
  status?: ProduceStatus;
}
