import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '../../../generated/client';

export class OrderDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  produceId: string;

  @ApiProperty({ format: 'uuid' })
  farmId: string;

  @ApiProperty({ format: 'uuid', description: 'User.id of the buyer' })
  buyerId: string;

  @ApiProperty({ example: 50, description: "In the produce's `unit`" })
  quantity: number;

  // Prisma serialises Decimal as a string, which keeps money exact.
  @ApiProperty({ type: String, example: '17525.00' })
  totalPrice: string;

  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status: OrderStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Set when the order is CANCELLED',
  })
  cancellationReason: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
