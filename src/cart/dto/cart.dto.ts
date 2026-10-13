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

  @ApiProperty({
    type: 'integer',
    example: 500,
    description: 'Stock still orderable',
  })
  floatingQuantity: number;

  @ApiProperty({ enum: ProduceStatus, enumName: 'ProduceStatus' })
  status: ProduceStatus;

  @ApiProperty({ type: CartProduceFarmDto })
  farm: CartProduceFarmDto;
}

export class CartLineDto {
  @ApiProperty({
    type: 'integer',
    example: 10,
    description: "Whole units of the produce's `unit`",
  })
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

export class CartItemDto extends CartLineDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
}

export class CartTotalsDto {
  @ApiProperty({ example: 2 })
  itemCount: number;

  @ApiProperty({
    type: String,
    example: '45000.00',
    description: 'Sum of lineTotal over items with no issue',
  })
  total: string;

  @ApiProperty({
    type: String,
    example: '3500.00',
    description: 'Flat delivery fee; 0.00 when nothing can be ordered',
  })
  deliveryFee: string;

  @ApiProperty({
    type: String,
    example: '2250.00',
    description: 'SERVICE_FEE_PERCENT of total',
  })
  serviceFee: string;

  @ApiProperty({
    type: String,
    example: '48500.00',
    description: 'total + deliveryFee + serviceFee: what checkout will charge',
  })
  grandTotal: string;
}

export class CartDto extends CartTotalsDto {
  @ApiProperty({ type: [CartItemDto], description: 'Newest first' })
  items: CartItemDto[];
}

export class CartQuoteDto extends CartTotalsDto {
  @ApiProperty({ type: [CartLineDto], description: 'In request order' })
  items: CartLineDto[];

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'Requested produce that is gone or not public; drop these from the device cart',
  })
  unavailableProduceIds: string[];
}

export class CartSkippedItemDto {
  @ApiProperty({ format: 'uuid' })
  produceId: string;

  @ApiProperty({
    example: 'INSUFFICIENT_STOCK',
    description:
      'CART_FULL, PRODUCE_NOT_FOUND, PRODUCE_UNAVAILABLE or INSUFFICIENT_STOCK',
  })
  code: string;

  @ApiProperty({ example: 'Only 3 Bags available' })
  message: string;
}

export class CartMergeDto extends CartDto {
  @ApiProperty({
    type: [CartSkippedItemDto],
    description: 'Items not merged, and why; everything else was added',
  })
  skipped: CartSkippedItemDto[];
}
