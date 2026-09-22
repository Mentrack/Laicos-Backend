import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateFarmDto {
  @ApiProperty({ example: 'Green Acres' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'Ogbomosho, Oyo State' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  location: string;

  @ApiProperty({ example: 2.5, description: 'Size in hectares' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  size: number;

  @ApiPropertyOptional({ example: 'ha', default: 'ha' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit?: string;

  @ApiProperty({ example: 'Maize' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  mainProduce: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isExporting?: boolean;

  @ApiPropertyOptional({ format: 'uuid', description: 'Referring agent' })
  @IsOptional()
  @IsUUID()
  referralAgentId?: string;
}
