import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
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

// The route is multipart (it carries the produce photo), so every field
// arrives as a string. The global ValidationPipe transforms but does not
// convert implicitly, so the number fields declare their own @Type.
export class CreateProduceDto {
  @ApiProperty({ format: 'uuid', description: 'A farm the caller owns' })
  @IsUUID()
  farmId: string;

  @ApiProperty({ example: 'Yellow maize' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({
    type: 'integer',
    example: 500,
    description:
      'Whole units of stock on hand, in `unit`. floatingQuantity starts equal to it and is managed by orders.',
  })
  @IsInt()
  @Min(0)
  @Type(() => Number)
  actualQuantity: number;

  @ApiProperty({ example: 'kg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit: string;

  @ApiProperty({ example: 350.5, description: 'Price of one `unit`' })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @IsPositive()
  @Type(() => Number)
  pricePerUnit: number;

  @ApiPropertyOptional({
    enum: ProduceStatus,
    enumName: 'ProduceStatus',
    default: ProduceStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(ProduceStatus)
  status?: ProduceStatus;

  @ApiPropertyOptional({
    enum: ProduceType,
    enumName: 'ProduceType',
    default: ProduceType.LOCAL,
  })
  @IsOptional()
  @IsEnum(ProduceType)
  type?: ProduceType;

  @ApiPropertyOptional({ enum: ProduceCategory, enumName: 'ProduceCategory' })
  @IsOptional()
  @IsEnum(ProduceCategory)
  category?: ProduceCategory;

  @ApiPropertyOptional({
    example: 'Freshly harvested premium cassava tubers.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ example: 'Grade A — Fresh Harvest', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  specs?: string;
}
