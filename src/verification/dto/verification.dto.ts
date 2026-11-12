import { ApiProperty, IntersectionType } from '@nestjs/swagger';
import {
  EvidenceKind,
  EvidenceStatus,
  PhotoSlot,
  VerificationCheckKey,
  VerificationTaskStatus,
} from '../../../generated/client';
import { IdentityDto } from '../../common/dto/identity.dto';
import { FarmSummaryDto } from '../../farm/dto';
import { VerificationFindingsDto } from './findings.dto';

export class VerificationFarmerDto extends IdentityDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'FRM-000123' })
  farmerId: string;

  @ApiProperty({ example: 'John' })
  firstName: string;

  @ApiProperty({ example: 'Farmer' })
  lastName: string;

  @ApiProperty({ type: String, nullable: true })
  phoneNumber: string | null;
}

export class VerificationFarmDto extends FarmSummaryDto {
  @ApiProperty()
  isExporting: boolean;

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

  @ApiProperty({ type: VerificationFarmerDto })
  farmer: VerificationFarmerDto;
}

export class VerificationEvidenceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: EvidenceKind, enumName: 'EvidenceKind' })
  kind: EvidenceKind;

  @ApiProperty({
    enum: VerificationCheckKey,
    enumName: 'VerificationCheckKey',
    nullable: true,
  })
  checkKey: VerificationCheckKey | null;

  @ApiProperty({ enum: PhotoSlot, enumName: 'PhotoSlot', nullable: true })
  photoSlot: PhotoSlot | null;

  @ApiProperty({ description: 'Presigned; expires in 15 min' })
  url: string;

  @ApiProperty()
  createdAt: Date;
}

export class VerificationSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    enum: VerificationTaskStatus,
    enumName: 'VerificationTaskStatus',
  })
  status: VerificationTaskStatus;

  @ApiProperty({ type: FarmSummaryDto })
  farm: FarmSummaryDto;

  @ApiProperty({ enum: EvidenceStatus, enumName: 'EvidenceStatus' })
  evidenceStatus: EvidenceStatus;

  @ApiProperty({ type: Date, nullable: true })
  startedAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  decidedAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

export class VerificationDto extends IntersectionType(
  VerificationSummaryDto,
  VerificationFindingsDto,
) {
  @ApiProperty({ type: VerificationFarmDto })
  declare farm: VerificationFarmDto;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Note sent to the assigned agent with the last information request',
  })
  informationRequestNote: string | null;

  @ApiProperty({ type: Date, nullable: true })
  informationRequestedAt: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned; expires in 15 min',
  })
  locationEvidenceUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned; expires in 15 min',
  })
  productionEvidenceUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned; expires in 15 min',
  })
  farmPlotSketchUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned; expires in 15 min',
  })
  harvestEstimateUrl: string | null;

  @ApiProperty({
    type: [VerificationEvidenceDto],
    description: 'Photos attached to a check that was marked ISSUE',
  })
  evidence: VerificationEvidenceDto[];

  @ApiProperty({
    type: [String],
    example: ['CROP_HEALTH is not recorded'],
    description: 'What still blocks approval; empty when ready to approve',
  })
  outstanding: string[];
}
