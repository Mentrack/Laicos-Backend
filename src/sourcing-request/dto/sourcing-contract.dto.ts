import { ApiProperty } from '@nestjs/swagger';
import { SourcingUnit } from '../../../generated/client';

export class SourcingContractPartyDto {
  @ApiProperty({ example: 'Ada Obi' })
  name: string;

  @ApiProperty({ example: 'BY-000001', description: 'Buyer or agent code' })
  code: string;
}

export class SourcingContractDeliveryDto {
  @ApiProperty({ example: 'Nigeria' })
  country: string;

  @ApiProperty({ example: '12 Bompai Road' })
  address: string;

  @ApiProperty({ type: String, nullable: true })
  region: string | null;

  // Names, set only for Nigeria.
  @ApiProperty({ type: String, nullable: true, example: 'Kano' })
  state: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Nassarawa' })
  lga: string | null;

  @ApiProperty({ type: String, nullable: true })
  contactName: string | null;

  @ApiProperty({ type: String, nullable: true })
  contactPhone: string | null;

  @ApiProperty({ format: 'date', example: '2026-11-20' })
  from: string;

  @ApiProperty({ format: 'date', example: '2026-11-25' })
  to: string;
}

export class SourcingContractLineDto {
  @ApiProperty({ example: 'LF-000001' })
  farmCode: string;

  @ApiProperty()
  farmerName: string;

  @ApiProperty()
  produceName: string;

  @ApiProperty({ description: "In `unit`, the offer's own unit" })
  quantity: number;

  @ApiProperty({ enum: SourcingUnit, enumName: 'SourcingUnit' })
  unit: SourcingUnit;

  @ApiProperty({ example: '1200.00', description: 'Per `unit`, to the farmer' })
  agreedUnitPrice: string;
}

/** The terms as they stood when the agent confirmed; never updated. */
export class SourcingContractTermsDto {
  @ApiProperty({ example: 'REQ-000015' })
  requestNumber: string;

  @ApiProperty({ type: SourcingContractPartyDto })
  buyer: SourcingContractPartyDto;

  @ApiProperty({ type: SourcingContractPartyDto })
  agent: SourcingContractPartyDto;

  @ApiProperty()
  produceName: string;

  @ApiProperty({ description: 'In `unit`, as the buyer asked' })
  quantity: number;

  @ApiProperty({ enum: SourcingUnit, enumName: 'SourcingUnit' })
  unit: SourcingUnit;

  @ApiProperty({ example: '150000.00', description: 'The buyer total' })
  agreedPrice: string;

  @ApiProperty({ type: SourcingContractDeliveryDto })
  delivery: SourcingContractDeliveryDto;

  @ApiProperty({ type: [SourcingContractLineDto] })
  lines: SourcingContractLineDto[];
}

export class SourcingContractDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '150000.00' })
  agreedPrice: string;

  // Stored as JSON; the shape is what confirm wrote (SourcingContractTermsDto).
  @ApiProperty({ type: SourcingContractTermsDto })
  terms: unknown;

  @ApiProperty({ type: Date, nullable: true })
  buyerSignedAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  agentSignedAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  voidedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  // Set once both parties have signed.
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  checkoutId: string | null;
}

// Shared by the agent and buyer sign routes.
export const SIGN_CONTRACT_DESCRIPTION =
  'Signing twice is a no-op. The second signature creates a hidden SOURCED listing per accepted offer, never touching the farms’ own listings, and places the buyer’s checkout at the agreed prices, held for SOURCING_CHECKOUT_HOLD_HOURS; the same Idempotency-Key then returns that checkout’s contract. 409 SOURCING_NOT_CONFIRMED when no contract is waiting. 409 IDEMPOTENCY_KEY_REUSED when the key placed the checkout of an earlier contract.';
