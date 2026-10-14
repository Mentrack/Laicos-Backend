import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Trimmed } from '../../common/dto/trimmed';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ada' })
  @IsOptional()
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Okafor' })
  @IsOptional()
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  lastName?: string;

  @ApiPropertyOptional({
    example: '+2348012345678',
    description: 'Phone number in E.164 format',
  })
  @IsOptional()
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  phoneNumber?: string;
}
