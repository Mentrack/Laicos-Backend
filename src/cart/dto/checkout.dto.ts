import { ApiProperty } from '@nestjs/swagger';
import { CheckoutStatus } from '../../../generated/client';
import { OrderDto } from '../../order/dto/order.dto';

export class ShippingToDto {
  @ApiProperty({ example: 'Warehouse A' })
  label: string;

  @ApiProperty({ example: '12, Bompai Industrial Area' })
  street: string;

  @ApiProperty({ example: 'Kano' })
  state: string;

  @ApiProperty({ example: 'Nassarawa' })
  lga: string;

  @ApiProperty({ type: String, nullable: true })
  contactName: string | null;

  @ApiProperty({ type: String, nullable: true })
  contactPhone: string | null;
}

export class CheckoutDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'CHK-000123' })
  checkoutNumber: string;

  @ApiProperty({ format: 'uuid', description: 'User.id of the buyer' })
  buyerId: string;

  @ApiProperty({ enum: CheckoutStatus, enumName: 'CheckoutStatus' })
  status: CheckoutStatus;

  @ApiProperty({ type: String, example: '54000.00', description: 'Items' })
  subtotal: string;

  @ApiProperty({ type: String, example: '3500.00' })
  deliveryFee: string;

  @ApiProperty({
    type: String,
    example: '57500.00',
    description: 'subtotal + deliveryFee: the amount to pay',
  })
  totalPrice: string;

  @ApiProperty({
    description:
      'An AWAITING_PAYMENT checkout expires at this time, releasing its stock',
  })
  expiresAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  paidAt: Date | null;

  @ApiProperty({ format: 'date', example: '2026-10-10' })
  deliveryDate: string;

  @ApiProperty({ type: ShippingToDto })
  shippingTo: ShippingToDto;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: [OrderDto], description: 'One per line' })
  orders: OrderDto[];
}
