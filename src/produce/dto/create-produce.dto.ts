import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ProduceStatus, ProduceType } from '../../../generated/client';

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
    example: 500,
    description:
      'Stock on hand, in `unit`. floatingQuantity starts equal to it and is managed by orders.',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  actualQuantity: number;

  @ApiProperty({ example: 'kg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit: string;

  @ApiProperty({ example: 350.5, description: 'Price of one `unit`' })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @IsPositive()
  pricePerUnit: number;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/maize.jpg' })
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

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
}
