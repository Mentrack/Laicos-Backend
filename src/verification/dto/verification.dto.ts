import { ApiProperty } from '@nestjs/swagger';
import {
  CheckResult,
  EvidenceKind,
  PhotoSlot,
  VerificationCheckKey,
  VerificationTaskStatus,
} from '../../../generated/client';
import { IdentityDto } from '../../common/dto/identity.dto';
import { FarmSummaryDto } from '../../farm/dto';

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

export class VerificationCheckDto {
  @ApiProperty({ enum: VerificationCheckKey, enumName: 'VerificationCheckKey' })
  key: VerificationCheckKey;

  @ApiProperty({ enum: CheckResult, enumName: 'CheckResult' })
  result: CheckResult;

  @ApiProperty({ type: String, nullable: true })
  note: string | null;
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

  @ApiProperty({ type: Date, nullable: true })
  startedAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  decidedAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

export class VerificationDto extends VerificationSummaryDto {
  @ApiProperty({ type: VerificationFarmDto })
  declare farm: VerificationFarmDto;

  @ApiProperty({ type: Boolean, nullable: true })
  locationMatches: boolean | null;

  @ApiProperty({ type: Number, nullable: true, example: 8.1234 })
  discrepancyLat: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 4.2567 })
  discrepancyLng: number | null;

  @ApiProperty({ type: String, nullable: true })
  discrepancyNote: string | null;

  @ApiProperty({ type: String, nullable: true })
  identityNote: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 4.8,
    description: 'Measured on site, in the farm’s unit',
  })
  measuredSize: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 12 })
  estimatedYield: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'tonnes' })
  estimatedYieldUnit: string | null;

  @ApiProperty({ type: String, nullable: true })
  generalNote: string | null;

  @ApiProperty({ type: String, nullable: true })
  rejectionReason: string | null;

  @ApiProperty({ type: [VerificationCheckDto] })
  checks: VerificationCheckDto[];

  @ApiProperty({ type: [VerificationEvidenceDto] })
  evidence: VerificationEvidenceDto[];

  @ApiProperty({
    type: [String],
    example: ['CROP_HEALTH is not recorded'],
    description: 'What still blocks approval; empty when ready to approve',
  })
  outstanding: string[];
}
