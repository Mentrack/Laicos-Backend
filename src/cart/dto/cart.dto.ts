import { ApiProperty } from '@nestjs/swagger';
import { ProduceStatus } from '../../../generated/client';

export enum CartItemIssue {
  UNAVAILABLE = 'UNAVAILABLE',
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
}

export class CartProduceFarmDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'LF-000123' })
  farmCode: string;
}

export class CartProduceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Premium Cassava' })
  name: string;

  @ApiProperty({ type: String, nullable: true })
  imageUrl: string | null;

  @ApiProperty({ example: 'Tuber' })
  unit: string;

  @ApiProperty({
    type: String,
    example: '4500.00',
    description: 'Current price',
  })
  pricePerUnit: string;

  @ApiProperty({ example: 500, description: 'Stock still orderable' })
  floatingQuantity: number;

  @ApiProperty({ enum: ProduceStatus, enumName: 'ProduceStatus' })
  status: ProduceStatus;

  @ApiProperty({ type: CartProduceFarmDto })
  farm: CartProduceFarmDto;
}

export class CartItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 10, description: "In the produce's `unit`" })
  quantity: number;

  @ApiProperty({
    type: String,
    example: '45000.00',
    description: 'Current price × quantity',
  })
  lineTotal: string;

  @ApiProperty({
    enum: CartItemIssue,
    enumName: 'CartItemIssue',
    nullable: true,
    description:
      'Why checkout would refuse this item; null when it can be ordered',
  })
  issue: CartItemIssue | null;

  @ApiProperty({ type: CartProduceDto })
  produce: CartProduceDto;
}

export class CartDto {
  @ApiProperty({ type: [CartItemDto], description: 'Newest first' })
  items: CartItemDto[];

  @ApiProperty({ example: 2 })
  itemCount: number;

  @ApiProperty({
    type: String,
    example: '45000.00',
    description: 'Sum of lineTotal over items with no issue',
  })
  total: string;
}
