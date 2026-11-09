import { ApiProperty } from '@nestjs/swagger';
import { DisputeStatus } from '../../../generated/client';
import { RefundDto } from '../../payment/dto';

export class DisputePhotoDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Presigned; expires in 15 min' })
  url: string;

  @ApiProperty()
  createdAt: Date;
}

export class DisputeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  orderId: string;

  @ApiProperty({ example: 'ORD-000123' })
  orderNumber: string;

  @ApiProperty({ enum: DisputeStatus, enumName: 'DisputeStatus' })
  status: DisputeStatus;

  @ApiProperty()
  reason: string;

  @ApiProperty({ type: 'integer', example: 2 })
  quantityAffected: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '30.00',
    description: 'Set on resolve; 0.00 means solved without a refund',
  })
  refundPercent: string | null;

  @ApiProperty({ type: String, nullable: true })
  resolutionNote: string | null;

  @ApiProperty({ type: Date, nullable: true })
  resolvedAt: Date | null;

  @ApiProperty({ type: [DisputePhotoDto] })
  photos: DisputePhotoDto[];

  @ApiProperty({
    type: [RefundDto],
    description: 'Oldest first; a re-issue after a failure adds one',
  })
  refunds: RefundDto[];

  @ApiProperty()
  createdAt: Date;
}
