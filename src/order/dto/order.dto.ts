import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus, ProduceType } from '../../../generated/client';

export class OrderDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ORD-000123', description: 'Human-readable code' })
  orderNumber: string;

  @ApiProperty({ format: 'uuid' })
  produceId: string;

  @ApiProperty({
    example: 'Premium Sesame Seeds',
    description: "The produce's name when the order was placed",
  })
  produceName: string;

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
    enum: ProduceType,
    enumName: 'ProduceType',
    description: "The produce's type when the order was placed",
  })
  type: ProduceType;

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
