import { ApiProperty } from '@nestjs/swagger';

export class OrderStatusCountsDto {
  @ApiProperty({ example: 3 })
  PENDING: number;

  @ApiProperty({ example: 2 })
  CONFIRMED: number;

  @ApiProperty({ example: 1 })
  PREPARING: number;

  @ApiProperty({ example: 1 })
  READY: number;

  @ApiProperty({ example: 1 })
  SHIPPED: number;

  @ApiProperty({ example: 7 })
  FULFILLED: number;

  @ApiProperty({ example: 1 })
  CANCELLED: number;
}

export class OrderCountDto {
  @ApiProperty({ example: 13 })
  total: number;

  @ApiProperty({ type: OrderStatusCountsDto })
  byStatus: OrderStatusCountsDto;
}
