import { ApiProperty } from '@nestjs/swagger';
import { FarmVerificationStatus } from '../../../generated/client';
import { LgaDto, StateDto } from '../../location/dto';

export class FarmDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'LF-000123', description: 'Public farm code' })
  farmCode: string;

  @ApiProperty({ format: 'uuid', description: 'Farmer.id of the owner' })
  ownerId: string;

  @ApiProperty({ example: 'Green Acres' })
  name: string;

  @ApiProperty({ example: 'NG' })
  country: string;

  @ApiProperty({ type: StateDto })
  state: StateDto;

  @ApiProperty({ type: LgaDto })
  lga: LgaDto;

  @ApiProperty({ example: '12 Market Road', description: 'Street address' })
  location: string;

  @ApiProperty({ example: 2.5, description: 'Size in hectares' })
  size: number;

  @ApiProperty({ example: 'ha' })
  unit: string;

  @ApiProperty({ example: 'Maize' })
  mainProduce: string;

  @ApiProperty()
  isExporting: boolean;

  @ApiProperty({
    format: 'uuid',
    type: String,
    nullable: true,
    description: 'Referring agent (Agent.id)',
  })
  referralAgentId: string | null;

  @ApiProperty({
    enum: FarmVerificationStatus,
    enumName: 'FarmVerificationStatus',
  })
  verificationStatus: FarmVerificationStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Why the latest verification was rejected, while REJECTED',
  })
  rejectionReason: string | null;

  @ApiProperty()
  isClustered: boolean;

  @ApiProperty({ format: 'uuid', type: String, nullable: true })
  clusterId: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned; expires in 15 min',
  })
  ownershipDocumentUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned; expires in 15 min',
  })
  chiefConfirmationUrl: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
