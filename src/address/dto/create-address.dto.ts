import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Trimmed } from '../../common/dto/trimmed';

export class CreateAddressDto {
  @ApiProperty({ example: 'Warehouse A', maxLength: 60 })
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label: string;

  @ApiProperty({ example: '12, Bompai Industrial Area', maxLength: 200 })
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  street: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  stateId: string;

  @ApiProperty({ format: 'uuid', description: 'Must lie in stateId' })
  @IsUUID()
  lgaId: string;

  @ApiPropertyOptional({ example: 'Musa Ibrahim', maxLength: 100 })
  @IsOptional()
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  contactName?: string;

  @ApiPropertyOptional({ example: '+2348012345678', maxLength: 20 })
  @IsOptional()
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  contactPhone?: string;
}
