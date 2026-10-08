import { ApiProperty, OmitType } from '@nestjs/swagger';
import { SourcingRequestStatus } from '../../../generated/client';
import { CreateSourcingRequestDto } from './create-sourcing-request.dto';

export class SourcingRequestDto extends OmitType(CreateSourcingRequestDto, [
  'additionalSpecs',
  'logisticsNotes',
] as const) {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'REQ-000015' })
  requestNumber: string;

  @ApiProperty({ type: String, nullable: true })
  additionalSpecs: string | null;

  @ApiProperty({ type: String, nullable: true })
  logisticsNotes: string | null;

  @ApiProperty({
    enum: SourcingRequestStatus,
    enumName: 'SourcingRequestStatus',
  })
  status: SourcingRequestStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
