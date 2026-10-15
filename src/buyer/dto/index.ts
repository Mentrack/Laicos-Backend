import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { BuyerType } from '../../../generated/client';
import { LgaDto, StateDto } from '../../location/dto';

export class BuyerDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'BY-000123', description: 'Public buyer code' })
  buyerId: string;
}

export class BuyerProfileDto extends BuyerDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ enum: BuyerType, enumName: 'BuyerType' })
  buyerType: BuyerType;

  @ApiProperty({ type: String, nullable: true })
  legalName: string | null;

  @ApiProperty({ type: String, nullable: true })
  department: string | null;

  @ApiProperty({ type: String, nullable: true })
  contactName: string | null;

  @ApiProperty({ type: String, nullable: true })
  contactPhone: string | null;

  @ApiProperty({ type: String, nullable: true })
  paymentTerms: string | null;

  @ApiProperty({ type: StateDto, nullable: true })
  state: StateDto | null;

  @ApiProperty({ type: LgaDto, nullable: true })
  lga: LgaDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class UpdateBuyerDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  stateId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Send with stateId; either alone is 400',
  })
  @IsOptional()
  @IsUUID()
  lgaId?: string;

  @ApiPropertyOptional({ enum: BuyerType, enumName: 'BuyerType' })
  @IsOptional()
  @IsEnum(BuyerType)
  buyerType?: BuyerType;

  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((dto: UpdateBuyerDto) => dto.legalName !== undefined)
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @ValidateIf((dto: UpdateBuyerDto) => dto.department !== undefined)
  @IsString()
  @MaxLength(120)
  department?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @ValidateIf((dto: UpdateBuyerDto) => dto.contactName !== undefined)
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @ValidateIf((dto: UpdateBuyerDto) => dto.contactPhone !== undefined)
  @IsString()
  @MaxLength(30)
  contactPhone?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((dto: UpdateBuyerDto) => dto.paymentTerms !== undefined)
  @IsString()
  @MaxLength(200)
  paymentTerms?: string;
}
