import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  SourcingOfferStatus,
  SourcingRequestStatus,
  SourcingUnit,
} from '../../../generated/client';

export class FarmerSourcingOfferDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: SourcingOfferStatus, enumName: 'SourcingOfferStatus' })
  status: SourcingOfferStatus;

  @ApiProperty({ description: 'In `unit`' })
  quantity: number;

  @ApiProperty({ enum: SourcingUnit, enumName: 'SourcingUnit' })
  unit: SourcingUnit;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1200.00',
    description: 'Per `unit`',
  })
  agreedUnitPrice: string | null;

  @ApiProperty({ description: "The request's produce" })
  produceName: string;

  @ApiProperty({ example: 'REQ-000123' })
  requestNumber: string;

  @ApiProperty({ type: Date })
  requiredDate: Date;

  @ApiProperty()
  deliveryDestination: string;

  @ApiProperty({
    enum: SourcingRequestStatus,
    enumName: 'SourcingRequestStatus',
  })
  requestStatus: SourcingRequestStatus;
}

export class RejectSourcingOfferDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
