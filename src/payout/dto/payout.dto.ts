import { ApiProperty } from '@nestjs/swagger';
import { PayeeRole, PayoutStatus } from '../../../generated/client';

export class PayoutItemDto {
  @ApiProperty({ format: 'uuid' })
  orderId: string;

  @ApiProperty({ type: String, example: '4000.00' })
  amount: string;
}

export class PayoutDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'PO-000123' })
  reference: string;

  @ApiProperty({
    format: 'uuid',
    description: 'User.id of the farmer or agent paid',
  })
  payeeId: string;

  @ApiProperty({ enum: PayeeRole, enumName: 'PayeeRole' })
  payeeRole: PayeeRole;

  @ApiProperty({ type: String, example: '9000.00', description: 'NGN' })
  amount: string;

  @ApiProperty({ enum: PayoutStatus, enumName: 'PayoutStatus' })
  status: PayoutStatus;

  @ApiProperty({ example: 'Guaranty Trust Bank' })
  bankName: string;

  @ApiProperty({ example: '******6789' })
  accountNumber: string;

  @ApiProperty({ example: 'ADA OKAFOR' })
  accountName: string;

  @ApiProperty({ type: String, nullable: true })
  failureReason: string | null;

  @ApiProperty({ type: Date, nullable: true })
  paidAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: [PayoutItemDto] })
  items: PayoutItemDto[];
}
