import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
  PickType,
} from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  BuyerType,
  CheckoutStatus,
  HandoverStatus,
  OrderStatus,
  SourcingOfferStatus,
  SourcingRequestStatus,
  SourcingUnit,
} from '../../../generated/client';
import { AuditEventDto } from '../../audit/dto/audit-event.dto';
import { PaginationQueryDto } from '../../common/pagination';
import { SourcingRequestDto } from './sourcing-request.dto';

export class AdminSourcingFilterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: SourcingRequestStatus,
    enumName: 'SourcingRequestStatus',
  })
  @IsOptional()
  @IsEnum(SourcingRequestStatus)
  status?: SourcingRequestStatus;
}

export class AdminSourcingQueryDto extends IntersectionType(
  AdminSourcingFilterDto,
  PaginationQueryDto,
) {}

export class AssignAgentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  agentId: string;
}

export class CloseSourcingRequestDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class AdminSourcingSummaryDto {
  @ApiProperty()
  total: number;

  @ApiProperty()
  pending: number;

  @ApiProperty()
  assigned: number;

  @ApiProperty()
  findingSupply: number;

  @ApiProperty()
  negotiating: number;

  @ApiProperty()
  confirmed: number;

  @ApiProperty()
  completed: number;

  @ApiProperty()
  fulfilled: number;

  @ApiProperty()
  closed: number;
}

export class AdminSourcingRowDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'REQ-000015' })
  requestNumber: string;

  @ApiProperty()
  buyerName: string;

  @ApiProperty()
  produceName: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  unit: string;

  @ApiProperty()
  deliveryDestination: string;

  @ApiProperty({ type: String, nullable: true })
  agentName: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'AG-000018' })
  agentCode: string | null;

  @ApiProperty({
    enum: SourcingRequestStatus,
    enumName: 'SourcingRequestStatus',
  })
  status: SourcingRequestStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  escalated: boolean;

  @ApiProperty({
    enum: ['IN_TRANSIT', 'PENDING_PICKUP'],
    nullable: true,
  })
  shipment: 'IN_TRANSIT' | 'PENDING_PICKUP' | null;
}

export class CoverageDto {
  @ApiProperty()
  requested: number;

  @ApiProperty()
  selected: number;

  @ApiProperty()
  remaining: number;
}

export class AdminBuyerCardDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  buyerId: string;

  @ApiProperty({ enum: BuyerType, enumName: 'BuyerType' })
  buyerType: BuyerType;

  @ApiProperty()
  displayName: string;

  @ApiProperty({ type: String, nullable: true })
  phoneNumber: string | null;

  @ApiProperty({ type: String, nullable: true })
  state: string | null;

  @ApiProperty({ type: String, nullable: true })
  lga: string | null;

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

  @ApiProperty({ type: [Object] })
  recentOrders: { id: string; orderNumber: string; status: OrderStatus }[];
}

export class AdminAssignmentDto {
  @ApiProperty({ format: 'uuid' })
  agentId: string;

  @ApiProperty()
  agentCode: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  clusterName: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'CL-000018' })
  clusterCode: string | null;
}

export class AdminSourcingOrderDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  orderNumber: string;

  @ApiProperty()
  farmCode: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status: OrderStatus;

  @ApiProperty({
    enum: HandoverStatus,
    enumName: 'HandoverStatus',
    nullable: true,
  })
  handoverStatus: HandoverStatus | null;
}

export class AdminLiveCheckoutDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: CheckoutStatus, enumName: 'CheckoutStatus' })
  status: CheckoutStatus;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty()
  total: string;
}

export class AdminAllocationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: SourcingOfferStatus, enumName: 'SourcingOfferStatus' })
  status: SourcingOfferStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1200.00',
    description: 'Per `unit`',
  })
  agreedUnitPrice: string | null;

  @ApiProperty({ format: 'uuid' })
  farmId: string;

  @ApiProperty()
  farmCode: string;

  @ApiProperty()
  farmName: string;

  @ApiProperty()
  farmerName: string;

  @ApiProperty({ description: 'In `unit`' })
  quantity: number;

  @ApiProperty({ enum: SourcingUnit, enumName: 'SourcingUnit' })
  unit: SourcingUnit;
}

export class AdminSourcingDetailDto extends PickType(SourcingRequestDto, [
  'id',
  'requestNumber',
  'produceName',
  'quantity',
  'unit',
  'quality',
  'packaging',
  'condition',
  'additionalSpecs',
  'deliveryDestination',
  'requiredDate',
  'timeline',
  'logisticsNotes',
  'status',
] as const) {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  conversationId: string | null;

  @ApiProperty({ type: Date, nullable: true })
  escalatedAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  closedAt: Date | null;

  @ApiProperty({ type: String, nullable: true })
  closeReason: string | null;

  @ApiProperty({ type: AdminBuyerCardDto })
  buyer: AdminBuyerCardDto;

  @ApiProperty({ type: AdminAssignmentDto, nullable: true })
  assignment: AdminAssignmentDto | null;

  @ApiProperty({ type: [AdminAllocationDto] })
  allocations: AdminAllocationDto[];

  @ApiProperty({
    type: CoverageDto,
    description:
      "Counts farmer-accepted offers only, in the request's unit (kg and tonne offers converted)",
  })
  coverage: CoverageDto;

  @ApiProperty({ type: AdminLiveCheckoutDto, nullable: true })
  checkout: AdminLiveCheckoutDto | null;

  @ApiProperty({ type: [AdminSourcingOrderDto] })
  orders: AdminSourcingOrderDto[];

  @ApiProperty({ type: [AuditEventDto], description: 'The newest five rows' })
  audit: AuditEventDto[];
}
