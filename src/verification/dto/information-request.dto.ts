import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { EvidenceStatus } from '../../../generated/client';

/** The documents an admin can ask the assigned agent to collect. */
export enum InformationRequestDocument {
  FARMER_ID = 'FARMER_ID',
  LOCATION_EVIDENCE = 'LOCATION_EVIDENCE',
  HARVEST_ESTIMATE = 'HARVEST_ESTIMATE',
}

export const INFORMATION_REQUEST_LABEL: Record<
  InformationRequestDocument,
  string
> = {
  [InformationRequestDocument.FARMER_ID]: 'Farmer ID',
  [InformationRequestDocument.LOCATION_EVIDENCE]: 'Location document',
  [InformationRequestDocument.HARVEST_ESTIMATE]: 'Signed declaration',
};

export class CreateInformationRequestDto {
  @ApiProperty({
    example: 'Please upload the location document before the next review.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note: string;

  @ApiProperty({
    enum: InformationRequestDocument,
    enumName: 'InformationRequestDocument',
    isArray: true,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(InformationRequestDocument, { each: true })
  documents: InformationRequestDocument[];
}

export class InformationRequestResultDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: EvidenceStatus, enumName: 'EvidenceStatus' })
  evidenceStatus: EvidenceStatus;

  @ApiProperty()
  informationRequestNote: string;

  @ApiProperty()
  informationRequestedAt: Date;

  @ApiProperty({
    enum: InformationRequestDocument,
    enumName: 'InformationRequestDocument',
    isArray: true,
    description: 'Requestable documents that are still missing',
  })
  missing: InformationRequestDocument[];
}
