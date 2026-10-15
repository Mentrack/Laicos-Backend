import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CheckResult,
  EvidenceStatus,
  VerificationCheckKey,
  VerificationTaskStatus,
} from '../../../generated/client';
import { ExpectedDocument } from '../utils/expected-document';
import { PaginationQueryDto } from '../../common/pagination';

export class VerificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: VerificationTaskStatus,
    enumName: 'VerificationTaskStatus',
  })
  @IsOptional()
  @IsEnum(VerificationTaskStatus)
  status?: VerificationTaskStatus;
}

// Drafts are saved step by step, so a discrepancy may arrive without its
// coordinates yet; approval is what insists on them.
export class SaveLocationDto {
  @ApiProperty({ description: 'false records a location discrepancy' })
  @IsBoolean()
  matches: boolean;

  @ApiPropertyOptional({ example: 8.1234 })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 4.2567 })
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ example: 'Farm is 2 km east of the stated address' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note?: string;
}

export class SaveCheckDto {
  @ApiProperty({
    enum: CheckResult,
    enumName: 'CheckResult',
    description:
      'Identity checks take VERIFIED, ISSUE or UNABLE; the rest VERIFIED, ISSUE or NOT_APPLICABLE',
  })
  @IsEnum(CheckResult)
  result: CheckResult;

  @ApiPropertyOptional({ description: 'Required on approval for an ISSUE' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note?: string;
}

export class UpdateVerificationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  identityNote?: string;

  @ApiPropertyOptional({ example: 4.8, description: 'In the farm’s unit' })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  measuredSize?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  estimatedYield?: number;

  @ApiPropertyOptional({ example: 'tonnes' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  estimatedYieldUnit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  generalNote?: string;

  @ApiPropertyOptional({
    enum: EvidenceStatus,
    enumName: 'EvidenceStatus',
    description:
      'AWAITING_DOCS and FOLLOW_UP stay until set again. MISSING_DOCS and INCOMPLETE are also recalculated when a document changes.',
  })
  @IsOptional()
  @IsEnum(EvidenceStatus)
  evidenceStatus?: EvidenceStatus;
}

// Multipart (it carries the image), so every field arrives as a string; the
// enums need no conversion.
export class AddEvidenceDto {
  @ApiPropertyOptional({
    enum: ExpectedDocument,
    enumName: 'ExpectedDocument',
    description:
      'One of the documents the round collects. Replaces that document. Send this or checkKey, not both.',
  })
  @IsOptional()
  @IsEnum(ExpectedDocument)
  document?: ExpectedDocument;

  @ApiPropertyOptional({
    enum: VerificationCheckKey,
    enumName: 'VerificationCheckKey',
    description: 'The check an ISSUE photo belongs to',
  })
  @IsOptional()
  @IsEnum(VerificationCheckKey)
  checkKey?: VerificationCheckKey;
}

export class VerificationReasonDto {
  @ApiProperty({ example: 'Farm could not be located at the address' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
