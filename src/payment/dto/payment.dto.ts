import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod, PaymentStatus } from '../../../generated/client';

export class BankTransferInstructionsDto {
  @ApiProperty({ example: 'Test Bank' })
  bankName: string;

  @ApiProperty({ example: 'LAICOS Escrow' })
  accountName: string;

  @ApiProperty({ example: '0123456789' })
  accountNumber: string;

  @ApiProperty({ type: String, example: '57500.00' })
  amount: string;

  @ApiProperty({
    example: 'PAY-000123',
    description: 'The transfer description the buyer must use',
  })
  narration: string;
}

export class PaymentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'PAY-000123' })
  reference: string;

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method: PaymentMethod;

  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  status: PaymentStatus;

  @ApiProperty({ type: String, example: '57500.00' })
  amount: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The provider's hosted payment page; null until a card provider is integrated",
  })
  authorizationUrl: string | null;

  @ApiProperty({ type: BankTransferInstructionsDto, nullable: true })
  bankTransfer: BankTransferInstructionsDto | null;

  @ApiProperty({ type: Date, nullable: true })
  paidAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}
