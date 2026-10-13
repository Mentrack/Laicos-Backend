import { ApiProperty } from '@nestjs/swagger';

export class EligibleOrderDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ORD-000123' })
  orderNumber: string;

  @ApiProperty({ type: String, example: '4000.00' })
  amount: string;

  @ApiProperty()
  fulfilledAt: Date;
}

export class EligiblePayoutDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Farmer.id; send to POST /admin/payouts',
  })
  farmerId: string;

  @ApiProperty({ example: 'FRM-000123' })
  farmerCode: string;

  @ApiProperty({ example: 'Ada' })
  firstName: string;

  @ApiProperty({ example: 'Okafor' })
  lastName: string;

  @ApiProperty({ example: 'Guaranty Trust Bank' })
  bankName: string;

  @ApiProperty({ example: '******6789' })
  accountNumber: string;

  @ApiProperty({
    example: 'ADA OKAFOR',
    description: 'As the bank holds it; check it matches the farmer',
  })
  accountName: string;

  @ApiProperty({ type: String, example: '9000.00', description: 'NGN' })
  total: string;

  @ApiProperty({ type: [EligibleOrderDto] })
  orders: EligibleOrderDto[];
}
