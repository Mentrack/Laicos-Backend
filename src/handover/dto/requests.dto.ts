import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { HandoverStatus } from '../../../generated/client';
import { PaginationQueryDto } from '../../common/pagination';

export class HandoverQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: HandoverStatus, enumName: 'HandoverStatus' })
  @IsOptional()
  @IsEnum(HandoverStatus)
  status?: HandoverStatus;
}

export class VerifyHandoverDto {
  @ApiPropertyOptional({ example: 'Bags counted and weighed; quality good' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note?: string;
}

export class CompleteHandoverDto {
  @ApiProperty({ example: 'Musa Ibrahim', description: 'Who took the goods' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  recipientName: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  recipientPhone?: string;

  @ApiPropertyOptional({ example: 'Loaded onto truck KJA-123-XY' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note?: string;
}
