import { ApiProperty, OmitType } from '@nestjs/swagger';
import {
  SourcingRequestStatus,
  SourcingTimeline,
} from '../../../generated/client';
import { CreateSourcingRequestDto } from './create-sourcing-request.dto';

export class SourcingRequestDto extends OmitType(CreateSourcingRequestDto, [
  'additionalSpecs',
  'logisticsNotes',
  'timeline',
] as const) {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'REQ-000015' })
  requestNumber: string;

  @ApiProperty({ type: String, nullable: true })
  additionalSpecs: string | null;

  @ApiProperty({ type: String, nullable: true })
  logisticsNotes: string | null;

  // Buyers no longer send it; only pre-redesign requests have a value.
  @ApiProperty({
    enum: SourcingTimeline,
    enumName: 'SourcingTimeline',
    nullable: true,
  })
  timeline: SourcingTimeline | null;

  @ApiProperty({
    enum: SourcingRequestStatus,
    enumName: 'SourcingRequestStatus',
  })
  status: SourcingRequestStatus;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  checkoutId: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
