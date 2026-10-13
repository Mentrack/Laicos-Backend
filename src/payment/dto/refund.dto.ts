import { ApiProperty } from '@nestjs/swagger';
import { RefundStatus } from '../../../generated/client';

export class RefundDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  orderId: string | null;

  @ApiProperty({
    type: String,
    example: '9450.00',
    description: "In the payment's currency",
  })
  amount: string;

  @ApiProperty({ enum: RefundStatus, enumName: 'RefundStatus' })
  status: RefundStatus;

  @ApiProperty()
  reason: string;

  @ApiProperty({ type: String, nullable: true })
  failureReason: string | null;

  @ApiProperty()
  createdAt: Date;
}
