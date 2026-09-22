import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
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
}
