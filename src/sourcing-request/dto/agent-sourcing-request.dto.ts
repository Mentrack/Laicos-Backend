import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PickType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SourcingOfferStatus, SourcingUnit } from '../../../generated/client';
import { IsNairaAmount } from '../../common/dto/naira-amount';
import { PaginationQueryDto } from '../../common/pagination';
import { CreateSourcingRequestDto } from './create-sourcing-request.dto';
import { SourcingContractDto } from './sourcing-contract.dto';
import { SourcingRequestDto } from './sourcing-request.dto';

export const MAX_SOURCING_OFFERS = 50;

export class DeclineSourcingRequestDto {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class AgentOfferDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  farmId: string;

  @ApiProperty()
  farmCode: string;

  @ApiProperty()
  farmName: string;

  @ApiProperty({ description: 'In `unit`' })
  quantity: number;

  @ApiProperty({ enum: SourcingUnit, enumName: 'SourcingUnit' })
  unit: SourcingUnit;

  @ApiProperty({ enum: SourcingOfferStatus, enumName: 'SourcingOfferStatus' })
  status: SourcingOfferStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1200.00',
    description: 'Per `unit`',
  })
  agreedUnitPrice: string | null;
}

export class AgentSourcingContractDto extends OmitType(SourcingContractDto, [
  'checkoutId',
] as const) {}

export class AgentSourcingRequestDto extends OmitType(SourcingRequestDto, [
  'checkoutId',
] as const) {
  // Set only while the request waits for this agent's answer.
  @ApiProperty({ type: Date, nullable: true })
  respondBy: Date | null;

  // Null until the agent accepts.
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  conversationId: string | null;

  @ApiProperty({ type: [AgentOfferDto] })
  offers: AgentOfferDto[];

  @ApiProperty({ type: AgentSourcingContractDto, nullable: true })
  contract: AgentSourcingContractDto | null;
}

export class AgentFarmQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'musa',
    description:
      "Replaces the default match on the request's produce name: matches the farm name, farm code, farmer name, farmer code, main produce or listing names.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid', description: "The farm's state" })
  @IsOptional()
  @IsUUID()
  stateId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: "The farm's LGA" })
  @IsOptional()
  @IsUUID()
  lgaId?: string;
}

export class SourcingFarmRowDto {
  @ApiProperty({ format: 'uuid' })
  farmId: string;

  @ApiProperty()
  farmCode: string;

  @ApiProperty()
  farmName: string;

  @ApiProperty()
  farmerName: string;

  @ApiProperty()
  farmerCode: string;

  @ApiProperty()
  state: string;

  @ApiProperty()
  lga: string;

  @ApiProperty()
  mainProduce: string;

  @ApiProperty({
    type: [String],
    description: 'Names of its published and sold-out listings',
  })
  listingNames: string[];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: "This request's offer to the farm, if any",
  })
  offerId: string | null;
}

export class SourcingOfferLineDto extends PickType(CreateSourcingRequestDto, [
  'unit',
] as const) {
  @ApiProperty({ format: 'uuid', description: 'A verified farm' })
  @IsUUID()
  farmId: string;

  @ApiProperty({
    type: 'integer',
    example: 50,
    description: 'Whole units of `unit`',
  })
  @IsInt()
  @IsPositive()
  quantity: number;
}

export class SetSourcingOffersDto {
  @ApiProperty({
    type: [SourcingOfferLineDto],
    description: `The whole supply pool, up to ${MAX_SOURCING_OFFERS} farms, each farmId once. Farms left out are withdrawn.`,
  })
  @IsArray()
  @ArrayMaxSize(MAX_SOURCING_OFFERS)
  @ArrayUnique((line: SourcingOfferLineDto) => line.farmId, {
    message: 'Each farmId may appear only once',
  })
  @ValidateNested({ each: true })
  @Type(() => SourcingOfferLineDto)
  offers: SourcingOfferLineDto[];
}

export class PriceSourcingOfferDto {
  @ApiProperty({
    example: '1200.50',
    description:
      "Naira per unit of the offer's own unit, above 0, at most 2 decimals",
  })
  @IsNairaAmount()
  agreedUnitPrice: string;
}

export class SourcingQuoteLineDto {
  @ApiProperty({ format: 'uuid' })
  offerId: string;

  @ApiProperty()
  produceName: string;

  @ApiProperty()
  farmCode: string;

  @ApiProperty({ description: 'In `unit`' })
  quantity: number;

  @ApiProperty({ enum: SourcingUnit, enumName: 'SourcingUnit' })
  unit: SourcingUnit;

  @ApiProperty({ example: '1200.00', description: 'Per `unit`' })
  agreedUnitPrice: string;

  @ApiProperty({ example: '4800.00' })
  total: string;

  @ApiProperty({ example: '480.00' })
  commission: string;
}

export class SourcingQuoteDto {
  @ApiProperty({ type: [SourcingQuoteLineDto] })
  lines: SourcingQuoteLineDto[];

  // Accepted offers without a price yet; they are left out of the figures.
  @ApiProperty()
  unpricedOffers: number;

  @ApiProperty({ example: '4800.00' })
  subtotal: string;

  @ApiProperty({ example: '240.00' })
  serviceFee: string;

  @ApiProperty({ example: '480.00' })
  agentCommission: string;

  @ApiProperty({
    example: '5520.00',
    description: 'The floor for the agreed price',
  })
  suggestedPrice: string;
}
