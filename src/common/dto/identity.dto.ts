import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IdType } from '../../../generated/client';

/** The ID fields a farmer or agent sets at profile setup. */
export class UpdateIdentityDto {
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
}

/** Identity as its owner (or their verifying agent) sees it. */
export class IdentityDto {
  @ApiProperty({ enum: IdType, enumName: 'IdType', nullable: true })
  idType: IdType | null;

  @ApiProperty({ type: String, nullable: true, example: '12345678901' })
  idNumber: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned URL of the uploaded ID document; expires in 15 min',
  })
  idDocumentUrl: string | null;
}
