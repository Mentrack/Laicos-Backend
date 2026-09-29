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
  EvidenceKind,
  PhotoSlot,
  VerificationCheckKey,
  VerificationTaskStatus,
} from '../../../generated/client';
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
}

// Multipart (it carries the image), so every field arrives as a string; the
// enums need no conversion.
export class AddEvidenceDto {
  @ApiProperty({ enum: EvidenceKind, enumName: 'EvidenceKind' })
  @IsEnum(EvidenceKind)
  kind: EvidenceKind;

  @ApiPropertyOptional({
    enum: VerificationCheckKey,
    enumName: 'VerificationCheckKey',
    description: 'Required for CHECK evidence only',
  })
  @IsOptional()
  @IsEnum(VerificationCheckKey)
  checkKey?: VerificationCheckKey;

  @ApiPropertyOptional({
    enum: PhotoSlot,
    enumName: 'PhotoSlot',
    description: 'Required for PHOTO evidence only; replaces that slot’s photo',
  })
  @IsOptional()
  @IsEnum(PhotoSlot)
  photoSlot?: PhotoSlot;
}

export class VerificationReasonDto {
  @ApiProperty({ example: 'Farm could not be located at the address' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
