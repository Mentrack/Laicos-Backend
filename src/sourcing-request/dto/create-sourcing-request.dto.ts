import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  PackagingType,
  ProduceCondition,
  QualityGrade,
  SourcingTimeline,
  SourcingUnit,
} from '../../../generated/client';
import { Trimmed } from '../../common/dto/trimmed';

export class CreateSourcingRequestDto {
  @ApiProperty({ example: 'Sesame Seeds (Bulk)', maxLength: 100 })
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  produceName: string;

  @ApiProperty({ example: 20, description: 'In `unit`' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  quantity: number;

  @ApiProperty({ enum: SourcingUnit, enumName: 'SourcingUnit' })
  @IsEnum(SourcingUnit)
  unit: SourcingUnit;

  @ApiProperty({ enum: QualityGrade, enumName: 'QualityGrade' })
  @IsEnum(QualityGrade)
  quality: QualityGrade;

  @ApiProperty({ enum: PackagingType, enumName: 'PackagingType' })
  @IsEnum(PackagingType)
  packaging: PackagingType;

  @ApiProperty({ enum: ProduceCondition, enumName: 'ProduceCondition' })
  @IsEnum(ProduceCondition)
  condition: ProduceCondition;

  @ApiPropertyOptional({
    example: 'Moisture content below 8%, purity minimum 99%',
    maxLength: 1000,
  })
  @IsOptional()
  @Trimmed()
  @IsString()
  @MaxLength(1000)
  additionalSpecs?: string;

  @ApiProperty({ example: 'Warehouse A, Ibadan, Oyo State', maxLength: 200 })
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  deliveryDestination: string;

  @ApiProperty({
    format: 'date',
    example: '2026-11-15',
    description: 'Today or later (Africa/Lagos)',
  })
  // Matches pins the date-only shape; strict ISO 8601 rejects 2026-02-30.
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'requiredDate must be YYYY-MM-DD',
  })
  @IsISO8601({ strict: true })
  requiredDate: string;

  @ApiProperty({ enum: SourcingTimeline, enumName: 'SourcingTimeline' })
  @IsEnum(SourcingTimeline)
  timeline: SourcingTimeline;

  @ApiPropertyOptional({
    example: 'Heavy truck offloading at dock 3',
    maxLength: 1000,
  })
  @IsOptional()
  @Trimmed()
  @IsString()
  @MaxLength(1000)
  logisticsNotes?: string;
}
