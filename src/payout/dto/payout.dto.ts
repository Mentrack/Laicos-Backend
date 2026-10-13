import { ApiProperty } from '@nestjs/swagger';
import { PayoutStatus } from '../../../generated/client';

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

  @ApiProperty({ format: 'uuid', description: 'Farmer.id' })
  farmerId: string;

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

export class PayoutBatchDto {
  @ApiProperty({ type: [PayoutDto] })
  payouts: PayoutDto[];

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Farmers with nothing eligible (or no bank account) right now',
  })
  skippedFarmerIds: string[];
}
