import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BuyerType,
  CheckoutStatus,
  HandoverStatus,
  OrderStatus,
  SourcingRequestStatus,
} from '../../../generated/client';
import { PaginationQueryDto } from '../../common/pagination';

export class AdminSourcingQueryDto extends PaginationQueryDto {
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

export class AssignAgentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  agentId: string;
}

export class AllocationItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  produceId: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class SaveAllocationsDto {
  @ApiProperty({ type: [AllocationItemDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AllocationItemDto)
  items: AllocationItemDto[];
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
  new: number;

  @ApiProperty()
  inReview: number;

  @ApiProperty()
  findingSupply: number;

  @ApiProperty()
  awaitingBuyer: number;

  @ApiProperty()
  confirmed: number;

  @ApiProperty()
  fulfilment: number;

  @ApiProperty()
  completed: number;

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

export class AdminAllocationDto {
  @ApiProperty({ format: 'uuid' })
  produceId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  unit: string;

  @ApiProperty()
  pricePerUnit: string;

  @ApiProperty()
  farmCode: string;

  @ApiProperty()
  farmName: string;

  @ApiProperty()
  farmerName: string;

  @ApiProperty()
  floatingQuantity: number;

  @ApiProperty({ type: Number, required: false })
  selectedQuantity?: number;
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

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  conversationId: string | null;
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
