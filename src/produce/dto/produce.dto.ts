import { ApiProperty } from '@nestjs/swagger';
import {
  FarmVerificationStatus,
  ProduceCategory,
  ProduceStatus,
  ProduceType,
} from '../../../generated/client';
import { LgaDto, StateDto } from '../../location/dto';

export class ProduceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  farmId: string;

  @ApiProperty({ example: 'Yellow maize' })
  name: string;

  @ApiProperty({
    example: 500,
    description: 'Original stock listed, in `unit`. Immutable after creation.',
  })
  quantity: number;

  @ApiProperty({
    example: 500,
    description: 'Stock not yet committed to a CONFIRMED order, in `unit`',
  })
  actualQuantity: number;

  @ApiProperty({
    example: 450,
    description: 'Stock still orderable: actual minus PENDING orders',
  })
  floatingQuantity: number;

  @ApiProperty({ example: 'kg' })
  unit: string;

  // Prisma serialises Decimal as a string, which keeps money exact.
  @ApiProperty({ type: String, example: '350.50' })
  pricePerUnit: string;

  @ApiProperty({ type: String, nullable: true })
  imageUrl: string | null;

  @ApiProperty({ enum: ProduceStatus, enumName: 'ProduceStatus' })
  status: ProduceStatus;

  @ApiProperty({ enum: ProduceType, enumName: 'ProduceType' })
  type: ProduceType;

  @ApiProperty({
    enum: ProduceCategory,
    enumName: 'ProduceCategory',
    nullable: true,
  })
  category: ProduceCategory | null;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Grade A — Fresh Harvest',
  })
  specs: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

// No street address: buyers order through the platform, not the farm gate.
export class ProduceFarmDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'LF-000123' })
  farmCode: string;

  @ApiProperty({
    enum: FarmVerificationStatus,
    enumName: 'FarmVerificationStatus',
  })
  verificationStatus: FarmVerificationStatus;

  @ApiProperty({ example: 'NG' })
  country: string;

  @ApiProperty({ type: StateDto })
  state: StateDto;

  @ApiProperty({ type: LgaDto })
  lga: LgaDto;
}

export class ProduceListingDto extends ProduceDto {
  @ApiProperty({ type: ProduceFarmDto })
  farm: ProduceFarmDto;
}
