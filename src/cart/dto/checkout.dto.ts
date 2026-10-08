import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';
import { OrderDto } from '../../order/dto';

export class CreateCheckoutDto {
  @ApiProperty({
    example: 45000,
    description:
      'The cart total the buyer saw. If current prices total differently, checkout is refused with CART_PRICE_CHANGED.',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  expectedTotal: number;
}

export class CheckoutDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'CHK-000123' })
  checkoutNumber: string;

  // Prisma serialises Decimal as a string, which keeps money exact.
  @ApiProperty({ type: String, example: '45000.00' })
  totalPrice: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: [OrderDto], description: 'One per cart item' })
  orders: OrderDto[];
}
