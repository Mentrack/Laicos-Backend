import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
} from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import {
  BuyerType,
  CheckoutStatus,
  Currency,
  DisputeStatus,
  FarmVerificationStatus,
  OrderStatus,
  PaymentProvider,
  ProduceType,
  SourcingUnit,
} from '../../../generated/client';
import { IsDateOnly } from '../../common/dto/date-only';
import { PaginationQueryDto } from '../../common/pagination';

export enum AdminOrderTab {
  ALL = 'ALL',
  ACTIVE = 'ACTIVE',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  ISSUES = 'ISSUES',
}

/** Filters shared by the order list and the tab counts. */
export class AdminOrderFilterDto {
  @ApiPropertyOptional({ enum: OrderStatus, enumName: 'OrderStatus' })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  produceId?: string;

  @ApiPropertyOptional({
    description:
      'Matches the order number, produce name, farm code, buyer code, buyer company name or buyer first or last name',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'First day to include, as a Lagos (WAT) calendar date',
  })
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Last day to include, as a Lagos (WAT) calendar date',
  })
  @IsOptional()
  @IsDateOnly()
  to?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort?: 'asc' | 'desc';
}

export class AdminOrderExportQueryDto extends AdminOrderFilterDto {
  @ApiPropertyOptional({
    enum: AdminOrderTab,
    enumName: 'AdminOrderTab',
    default: AdminOrderTab.ALL,
    description:
      'ACTIVE is PENDING to SHIPPED, DELIVERED is FULFILLED, ISSUES is orders with a dispute. Combined with status by AND.',
  })
  @IsOptional()
  @IsEnum(AdminOrderTab)
  tab?: AdminOrderTab;
}

export class AdminOrderQueryDto extends IntersectionType(
  AdminOrderExportQueryDto,
  PaginationQueryDto,
) {}

class AdminOrderProduceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Premium Sesame Seeds' })
  name: string;

  @ApiProperty({ enum: ProduceType, enumName: 'ProduceType' })
  type: ProduceType;
}

class AdminOrderBuyerDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'BYR-000001' })
  buyerId: string;

  @ApiProperty({
    example: 'Acme Foods Ltd',
    description: 'Company name for company buyers, else the buyer name',
  })
  name: string;
}

class AdminOrderFarmDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'LF-000001' })
  farmCode: string;

  @ApiProperty({ example: 'Green Acres' })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'CL-000001',
    description: 'Null when the farm is not in a cluster',
  })
  clusterCode: string | null;
}

class AdminOrderSourcingRequestDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'REQ-000001' })
  requestNumber: string;
}

class AdminOrderDisputeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: DisputeStatus, enumName: 'DisputeStatus' })
  status: DisputeStatus;
}

export class AdminOrderRowDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ORD-000123' })
  orderNumber: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status: OrderStatus;

  @ApiProperty({ type: 'integer', example: 50 })
  quantity: number;

  @ApiProperty({ example: 'kg', description: 'Unit of the produce' })
  unit: string;

  @ApiProperty({ type: AdminOrderProduceDto })
  produce: AdminOrderProduceDto;

  @ApiProperty({ type: AdminOrderBuyerDto })
  buyer: AdminOrderBuyerDto;

  @ApiProperty({ type: AdminOrderFarmDto })
  farm: AdminOrderFarmDto;

  @ApiProperty({
    type: AdminOrderSourcingRequestDto,
    nullable: true,
    description: 'Null when the order was not placed from a sourcing request',
  })
  sourcingRequest: AdminOrderSourcingRequestDto | null;

  @ApiProperty({ type: String, example: '17525.00' })
  totalPrice: string;

  @ApiProperty({ type: AdminOrderDisputeDto, nullable: true })
  dispute: AdminOrderDisputeDto | null;
}

export class AdminOrderCountsDto {
  @ApiProperty({ example: 120 })
  all: number;

  @ApiProperty({ example: 40 })
  active: number;

  @ApiProperty({ example: 70 })
  delivered: number;

  @ApiProperty({ example: 8 })
  cancelled: number;

  @ApiProperty({ example: 2, description: 'Orders with a dispute' })
  issues: number;
}

class AdminOrderDetailOrderDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ORD-000123' })
  orderNumber: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status: OrderStatus;

  @ApiProperty({ type: 'integer', example: 50 })
  quantity: number;

  @ApiProperty({ example: 'kg', description: 'Unit of the produce' })
  unit: string;

  @ApiProperty({ example: 'Premium Sesame Seeds' })
  produceName: string;

  @ApiProperty({ enum: ProduceType, enumName: 'ProduceType' })
  type: ProduceType;

  @ApiProperty({ type: String, example: '17525.00' })
  totalPrice: string;

  @ApiProperty({ type: String, example: '875.00' })
  agentCommission: string;

  @ApiProperty({ type: String, nullable: true })
  cancellationReason: string | null;

  @ApiProperty({ type: Date, nullable: true })
  fulfilledAt: Date | null;
}

class AdminOrderDetailBuyerDto extends AdminOrderBuyerDto {
  @ApiProperty({ enum: BuyerType, enumName: 'BuyerType' })
  buyerType: BuyerType;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "The buyer's contact phone, else the user's phone",
  })
  contactPhone: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Warehouse, 4 Marina Road, Lagos Island, Lagos',
    description:
      "The checkout's delivery address snapshot. Null for orders placed before checkouts existed.",
  })
  deliveryDestination: string | null;
}

class AdminOrderDetailFarmDto extends AdminOrderFarmDto {
  @ApiProperty({ example: 'Ikeja' })
  lga: string;

  @ApiProperty({ example: 'Lagos' })
  state: string;

  @ApiProperty({
    enum: FarmVerificationStatus,
    enumName: 'FarmVerificationStatus',
  })
  verificationStatus: FarmVerificationStatus;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'When the latest approved verification round was decided',
  })
  verifiedAt: Date | null;
}

class AdminOrderPaymentAttemptDto {
  @ApiProperty({ example: 'PAY-000123' })
  reference: string;

  @ApiProperty({ enum: PaymentProvider, enumName: 'PaymentProvider' })
  provider: PaymentProvider;

  @ApiProperty({ type: String, nullable: true, example: 'card' })
  channel: string | null;

  @ApiProperty({ type: String, example: '17525.00' })
  amount: string;

  @ApiProperty({ enum: Currency, enumName: 'Currency' })
  currency: Currency;
}

class AdminOrderPaymentDto {
  @ApiProperty({ example: 'CHK-000123' })
  checkoutNumber: string;

  @ApiProperty({ enum: CheckoutStatus, enumName: 'CheckoutStatus' })
  checkoutStatus: CheckoutStatus;

  @ApiProperty({ type: String, example: '17525.00' })
  total: string;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  paidAt: Date | null;

  @ApiProperty({
    type: AdminOrderPaymentAttemptDto,
    nullable: true,
    description: 'The succeeded payment, null until the checkout is paid',
  })
  payment: AdminOrderPaymentAttemptDto | null;
}

class AdminOrderDetailSourcingRequestDto extends AdminOrderSourcingRequestDto {
  @ApiProperty({ example: 'Sesame' })
  produceName: string;

  @ApiProperty({ example: 500 })
  quantity: number;

  @ApiProperty({ enum: SourcingUnit, enumName: 'SourcingUnit' })
  unit: SourcingUnit;

  @ApiProperty({ example: 3, description: 'Distinct farms in the allocation' })
  farmsAllocated: number;

  @ApiProperty({ description: 'When the checkout was created' })
  confirmedAt: Date;
}

class AdminOrderDetailDisputeDto extends AdminOrderDisputeDto {
  @ApiProperty()
  reason: string;

  @ApiProperty({ type: 'integer', example: 5 })
  quantityAffected: number;

  @ApiProperty({ example: 'Ada Obi' })
  raisedBy: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: String, nullable: true, example: '50.00' })
  refundPercent: string | null;

  @ApiProperty({ type: String, nullable: true })
  resolutionNote: string | null;

  @ApiProperty({ type: Date, nullable: true })
  resolvedAt: Date | null;
}

export class AdminOrderDetailDto {
  @ApiProperty({ type: AdminOrderDetailOrderDto })
  order: AdminOrderDetailOrderDto;

  @ApiProperty({ type: AdminOrderDetailBuyerDto })
  buyer: AdminOrderDetailBuyerDto;

  @ApiProperty({ type: AdminOrderDetailFarmDto })
  farm: AdminOrderDetailFarmDto;

  @ApiProperty({
    type: AdminOrderPaymentDto,
    nullable: true,
    description: 'Null for orders placed before checkouts existed',
  })
  payment: AdminOrderPaymentDto | null;

  @ApiProperty({
    type: AdminOrderDetailSourcingRequestDto,
    nullable: true,
    description: 'Null when the order was not placed from a sourcing request',
  })
  sourcingRequest: AdminOrderDetailSourcingRequestDto | null;

  @ApiProperty({ type: AdminOrderDetailDisputeDto, nullable: true })
  dispute: AdminOrderDetailDisputeDto | null;
}
