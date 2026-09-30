import { ApiProperty } from '@nestjs/swagger';
import { HandoverStatus, ProduceType } from '../../../generated/client';
import { FarmSummaryDto } from '../../farm/dto';

export class HandoverDto {
  @ApiProperty({ format: 'uuid', description: 'The order’s id' })
  orderId: string;

  @ApiProperty({ example: 'ORD-000123' })
  orderNumber: string;

  @ApiProperty({ enum: HandoverStatus, enumName: 'HandoverStatus' })
  status: HandoverStatus;

  @ApiProperty({ example: 'Maize' })
  produceName: string;

  @ApiProperty({ example: 12.5, description: 'In `unit`' })
  quantity: number;

  @ApiProperty({ example: 'tons' })
  unit: string;

  @ApiProperty({ enum: ProduceType, enumName: 'ProduceType' })
  type: ProduceType;

  @ApiProperty({ type: FarmSummaryDto })
  farm: FarmSummaryDto;

  @ApiProperty({ type: String, nullable: true })
  verificationNote: string | null;

  @ApiProperty({ type: Date, nullable: true })
  verifiedAt: Date | null;

  @ApiProperty({ type: String, nullable: true, example: 'Musa Ibrahim' })
  recipientName: string | null;

  @ApiProperty({ type: String, nullable: true, example: '+2348012345678' })
  recipientPhone: string | null;

  @ApiProperty({ type: String, nullable: true })
  handoverNote: string | null;

  @ApiProperty({ type: Date, nullable: true })
  handedOverAt: Date | null;

  @ApiProperty({ description: 'When the order was marked READY' })
  createdAt: Date;
}
