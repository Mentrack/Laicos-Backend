import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
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

/**
 * Converts a multipart "true"/"false". Only the exact strings convert;
 * anything else reaches the boolean validator and fails there, rather than
 * silently reading as false.
 */
export const MultipartBoolean = () =>
  Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  );

// Create is multipart (it carries the ownership documents), so every field
// arrives as a string. The global ValidationPipe transforms but does not
// convert implicitly, so numbers and booleans declare their own conversion.
// UpdateFarmDto reuses these for JSON, where they pass values through.
export class CreateFarmDto {
  @ApiProperty({ example: 'Green Acres' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ format: 'uuid', description: 'From GET /locations/states' })
  @IsUUID()
  stateId: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'From GET /locations/states/{stateId}/lgas; decides which agents verify the farm',
  })
  @IsUUID()
  lgaId: string;

  @ApiProperty({ example: '12 Market Road', description: 'Street address' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  location: string;

  @ApiProperty({ example: 2.5, description: 'Size in hectares' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  @Type(() => Number)
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
  @MultipartBoolean()
  @IsBoolean()
  isExporting?: boolean;

  @ApiPropertyOptional({ format: 'uuid', description: 'Referring Agent.id' })
  @IsOptional()
  @IsUUID()
  referralAgentId?: string;
}
