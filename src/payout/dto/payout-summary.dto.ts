import { ApiProperty } from '@nestjs/swagger';

export class PayoutSummaryDto {
  @ApiProperty({
    type: String,
    example: '9235.50',
    description: 'NGN: the sum of your SUCCEEDED payouts',
  })
  totalEarnings: string;
}
