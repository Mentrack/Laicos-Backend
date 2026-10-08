import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ProduceCategory,
  ProduceStatus,
  ProduceType,
} from '../../../generated/client';
import { PaginationQueryDto } from '../../common/pagination';

export enum ProduceSort {
  NEWEST = 'NEWEST',
  PRICE_ASC = 'PRICE_ASC',
  PRICE_DESC = 'PRICE_DESC',
  STOCK_DESC = 'STOCK_DESC',
}

export class ProduceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ProduceStatus,
    enumName: 'ProduceStatus',
    description:
      'Defaults to PUBLISHED for everyone but farmers, so buyers only see what they can order.',
  })
  @IsOptional()
  @IsEnum(ProduceStatus)
  status?: ProduceStatus;

  @ApiPropertyOptional({ enum: ProduceType, enumName: 'ProduceType' })
  @IsOptional()
  @IsEnum(ProduceType)
  type?: ProduceType;

  @ApiPropertyOptional({ enum: ProduceCategory, enumName: 'ProduceCategory' })
  @IsOptional()
  @IsEnum(ProduceCategory)
  category?: ProduceCategory;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  farmId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: "The farm's state" })
  @IsOptional()
  @IsUUID()
  stateId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: "The farm's LGA" })
  @IsOptional()
  @IsUUID()
  lgaId?: string;

  @ApiPropertyOptional({
    example: 'cassava',
    description: 'Case-insensitive match on the name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ example: 100, description: 'Lowest pricePerUnit' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 500, description: 'Highest pricePerUnit' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({
    enum: ProduceSort,
    enumName: 'ProduceSort',
    default: ProduceSort.NEWEST,
  })
  @IsOptional()
  @IsEnum(ProduceSort)
  sort?: ProduceSort;
}
