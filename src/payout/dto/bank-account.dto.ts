import { ApiProperty } from '@nestjs/swagger';

export class BankAccountDto {
  @ApiProperty({ example: '058' })
  bankCode: string;

  @ApiProperty({ example: 'Guaranty Trust Bank' })
  bankName: string;

  @ApiProperty({ example: '******6789' })
  accountNumber: string;

  @ApiProperty({
    example: 'ADA OKAFOR',
    description: 'As the bank holds it; confirm it is the farmer',
  })
  accountName: string;

  @ApiProperty({
    description: 'Payouts wait until this time after any change (24h)',
  })
  payoutsHeldUntil: Date;

  @ApiProperty()
  updatedAt: Date;
}
