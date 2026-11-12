import { ApiProperty } from '@nestjs/swagger';
import { CheckResult, VerificationCheckKey } from '../../../generated/client';

// Kept apart from verification.dto.ts: that file imports farm/dto, which
// imports these findings, and a cycle leaves a base class undefined.
export class VerificationCheckDto {
  @ApiProperty({ enum: VerificationCheckKey, enumName: 'VerificationCheckKey' })
  key: VerificationCheckKey;

  @ApiProperty({ enum: CheckResult, enumName: 'CheckResult' })
  result: CheckResult;

  @ApiProperty({ type: String, nullable: true })
  note: string | null;
}

export class VerificationFindingsDto {
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
}
