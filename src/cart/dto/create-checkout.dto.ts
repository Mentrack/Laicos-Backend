import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsUUID, Min } from 'class-validator';
import { IsDateOnly } from '../../common/dto/date-only';

/** What the buyer chose on the checkout screen; Buy Now sends it too. */
export class CreateCheckoutDto {
  @ApiProperty({
    example: 57500,
    description:
      'The grand total the buyer saw: items plus the delivery fee. If current prices total differently, checkout is refused with CART_PRICE_CHANGED.',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  expectedTotal: number;

  @ApiProperty({ format: 'uuid', description: 'One of the buyer’s addresses' })
  @IsUUID()
  addressId: string;

  @ApiProperty({
    format: 'date',
    example: '2026-10-10',
    description:
      'Between DELIVERY_MIN_DAYS and DELIVERY_MAX_DAYS from today (Africa/Lagos)',
  })
  @IsDateOnly()
  deliveryDate: string;
}
