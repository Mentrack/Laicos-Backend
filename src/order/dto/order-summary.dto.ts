import { ApiProperty } from '@nestjs/swagger';

export class OrderSummaryDto {
  // Prisma serialises Decimal as a string, which keeps money exact.
  @ApiProperty({
    type: String,
    example: '450000.00',
    description: 'NGN paid out to you: the sum of your SUCCEEDED payouts',
  })
  totalEarnings: string;

  @ApiProperty({
    example: 3,
    description: 'Orders not yet FULFILLED or CANCELLED',
  })
  activeOrders: number;
}
