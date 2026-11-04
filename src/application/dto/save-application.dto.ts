import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IdType } from '../../../generated/client';
import { MultipartBoolean } from '../../farm/dto/create-farm.dto';

/** Partial application. Omitted fields stay as they are. Multipart, like a farm. */
export class SaveApplicationDto {
  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  phoneNumber?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @MultipartBoolean()
  @IsBoolean()
  agreedToTerms?: boolean;

  @ApiPropertyOptional({ enum: IdType, enumName: 'IdType' })
  @IsOptional()
  @IsEnum(IdType)
  idType?: IdType;

  @ApiPropertyOptional({ example: '12345678901' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  idNumber?: string;

  @ApiPropertyOptional({ example: 'Green Acres' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  farmName?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  stateId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lgaId?: string;

  @ApiPropertyOptional({ example: '12 Market Road' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  location?: string;

  @ApiPropertyOptional({ example: 2.5 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  @Type(() => Number)
  size?: number;

  @ApiPropertyOptional({ example: 'ha' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({ example: 'Maize' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  mainProduce?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @MultipartBoolean()
  @IsBoolean()
  isExporting?: boolean;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  referralAgentId?: string;
}
