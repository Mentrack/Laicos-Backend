import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApplicationStatus, IdType } from '../../../generated/client';

export class ApplicationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ApplicationStatus, enumName: 'ApplicationStatus' })
  status: ApplicationStatus;

  @ApiProperty({ type: String, nullable: true })
  phoneNumber: string | null;

  @ApiProperty()
  agreedToTerms: boolean;

  @ApiProperty({ enum: IdType, enumName: 'IdType', nullable: true })
  idType: IdType | null;

  @ApiProperty({ type: String, nullable: true })
  idNumber: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned URL of the ID document; expires in 15 min',
  })
  idDocumentUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  farmName: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  stateId: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  lgaId: string | null;

  @ApiProperty({ type: String, nullable: true })
  location: string | null;

  @ApiProperty({ type: Number, nullable: true })
  size: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  unit: string | null;

  @ApiProperty({ type: String, nullable: true })
  mainProduce: string | null;

  @ApiProperty({ type: Boolean, nullable: true })
  isExporting: boolean | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  referralAgentId: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned URL of the ownership document; expires in 15 min',
  })
  ownershipDocumentUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned URL of the chief’s confirmation; expires in 15 min',
  })
  chiefConfirmationUrl: string | null;
}
