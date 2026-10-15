import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  EvidenceKind,
  EvidenceStatus,
  FarmerStatus,
  FarmVerificationStatus,
  OrderStatus,
  PhotoSlot,
  ProduceStatus,
  VerificationCheckKey,
  VerificationTaskStatus,
} from '../../../generated/client';
import { PaginationQueryDto } from '../../common/pagination';
import { LgaDto, StateDto } from '../../location/dto';
import { FarmDto } from './farm.dto';

export class AdminFarmFarmerDto {
  @ApiProperty({ format: 'uuid', description: 'Farmer.id' })
  id: string;

  @ApiProperty({ example: 'FRM-000123' })
  farmerId: string;

  @ApiProperty({ example: 'Amina' })
  firstName: string;

  @ApiProperty({ example: 'Garba' })
  lastName: string;

  @ApiProperty({ example: '+2348012345678', nullable: true, type: String })
  phoneNumber: string | null;

  @ApiProperty({
    enum: FarmerStatus,
    enumName: 'FarmerStatus',
    description: 'Account standing. New farmers are ACTIVE',
  })
  status: FarmerStatus;
}

export class AdminFarmRowDto {
  @ApiProperty({ format: 'uuid', description: 'Farm.id' })
  id: string;

  @ApiProperty({ example: 'LF-000123' })
  farmCode: string;

  @ApiProperty({ example: 'Green Acres' })
  name: string;

  @ApiProperty({ example: 5, description: 'Size in hectares' })
  size: number;

  @ApiProperty({ example: 'ha' })
  unit: string;

  @ApiProperty({ example: 'Maize' })
  mainProduce: string;

  @ApiProperty({
    enum: FarmVerificationStatus,
    enumName: 'FarmVerificationStatus',
  })
  verificationStatus: FarmVerificationStatus;

  @ApiProperty({ type: StateDto })
  state: StateDto;

  @ApiProperty({ type: LgaDto })
  lga: LgaDto;

  @ApiProperty({ type: AdminFarmFarmerDto })
  farmer: AdminFarmFarmerDto;
}

export class AdminFarmAgentDto {
  @ApiProperty({ format: 'uuid', description: 'Agent.id' })
  id: string;

  @ApiProperty({ example: 'AG-000123' })
  agentId: string;

  @ApiProperty({ example: 'Halima' })
  firstName: string;

  @ApiProperty({ example: 'Bello' })
  lastName: string;
}

/** Agent who manages the farm's cluster, with the stats the evidence card shows. */
export class AdminFarmAssignedAgentDto extends AdminFarmAgentDto {
  @ApiProperty({ type: StateDto, nullable: true })
  state: StateDto | null;

  @ApiProperty({ type: LgaDto, nullable: true })
  lga: LgaDto | null;

  @ApiProperty({
    type: 'integer',
    description: "Farms in this agent's cluster",
  })
  farmCount: number;

  @ApiProperty({
    type: 'integer',
    description: 'Verification rounds on this farm handled by this agent',
  })
  visits: number;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'Latest decided, started, or opened time of those rounds',
  })
  lastVisitAt: Date | null;
}

export class AdminFarmClusterDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Dawakin Kudu Hub',
    description: 'Set when the agent sets their LGA',
  })
  name: string | null;

  @ApiProperty({
    type: 'integer',
    description: 'Farms currently in the cluster',
  })
  farmCount: number;
}

export class AdminFarmProductDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'White maize' })
  name: string;

  @ApiProperty({
    type: 'integer',
    example: 8000,
    description: 'Amount first listed, in `unit`',
  })
  quantity: number;

  @ApiProperty({ example: 'kg' })
  unit: string;

  @ApiProperty({ type: String, example: '280.00' })
  pricePerUnit: string;

  @ApiProperty({ enum: ProduceStatus, enumName: 'ProduceStatus' })
  status: ProduceStatus;
}

export class AdminFarmOrderDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ORD-000123' })
  orderNumber: string;

  @ApiProperty({ example: 'White maize' })
  produceName: string;

  @ApiProperty({ type: 'integer', example: 1000 })
  quantity: number;

  @ApiProperty({ example: 'kg' })
  unit: string;

  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  status: OrderStatus;
}

export class AdminFarmMarketplaceDto {
  @ApiProperty({ type: [AdminFarmProductDto] })
  products: AdminFarmProductDto[];

  @ApiProperty({
    type: 'integer',
    description: 'Listings whose status is PUBLISHED',
  })
  activeProducts: number;

  @ApiProperty({
    type: 'integer',
    description: 'Orders whose status is FULFILLED',
  })
  completedOrders: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Sum of quantity on every order except CANCELLED and AWAITING_PAYMENT. Units are not converted.',
  })
  totalSold: number;

  @ApiProperty({ type: [AdminFarmOrderDto], description: 'Five newest sales' })
  recentOrders: AdminFarmOrderDto[];
}

/** Same fields as a verification evidence item. Presigned URL expires in 15 minutes. */
export class AdminFarmEvidenceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: EvidenceKind, enumName: 'EvidenceKind' })
  kind: EvidenceKind;

  @ApiProperty({
    enum: VerificationCheckKey,
    enumName: 'VerificationCheckKey',
    nullable: true,
  })
  checkKey: VerificationCheckKey | null;

  @ApiProperty({ enum: PhotoSlot, enumName: 'PhotoSlot', nullable: true })
  photoSlot: PhotoSlot | null;

  @ApiProperty({ description: 'Presigned; expires in 15 min' })
  url: string;

  @ApiProperty()
  createdAt: Date;
}

/** One evidence file for the evidence card, across every verification round. */
export class AdminFarmEvidenceFileDto extends AdminFarmEvidenceDto {
  @ApiProperty({ format: 'uuid' })
  verificationId: string;
}

export class AdminFarmDocumentsDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned; expires in 15 min',
  })
  locationEvidenceUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned; expires in 15 min',
  })
  productionEvidenceUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned; expires in 15 min',
  })
  farmPlotSketchUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned; expires in 15 min',
  })
  harvestEstimateUrl: string | null;
}

export class AdminFarmVerificationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    enum: VerificationTaskStatus,
    enumName: 'VerificationTaskStatus',
  })
  status: VerificationTaskStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  decidedAt: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Rejection reason when REJECTED, otherwise the general note',
  })
  note: string | null;

  @ApiProperty({ enum: EvidenceStatus, enumName: 'EvidenceStatus' })
  evidenceStatus: EvidenceStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Note sent to the assigned agent with the last information request',
  })
  informationRequestNote: string | null;

  @ApiProperty({ type: Date, nullable: true })
  informationRequestedAt: Date | null;

  @ApiProperty({ type: AdminFarmDocumentsDto })
  documents: AdminFarmDocumentsDto;

  @ApiProperty({ type: AdminFarmAgentDto, nullable: true })
  agent: AdminFarmAgentDto | null;

  @ApiProperty({
    type: [AdminFarmEvidenceDto],
    description: 'Photos attached to a check that was marked ISSUE',
  })
  evidence: AdminFarmEvidenceDto[];
}

/** FarmDto plus the farmer header, sales, cluster, evidence, and verification rounds. */
export class AdminFarmDetailDto extends FarmDto {
  @ApiProperty({ type: AdminFarmFarmerDto })
  farmer: AdminFarmFarmerDto;

  @ApiProperty({ type: AdminFarmMarketplaceDto })
  marketplace: AdminFarmMarketplaceDto;

  @ApiProperty({
    type: AdminFarmClusterDto,
    nullable: true,
    description: 'Null when the farm is not in a cluster',
  })
  cluster: AdminFarmClusterDto | null;

  @ApiProperty({
    type: [AdminFarmEvidenceFileDto],
    description: 'Every evidence file, newest first',
  })
  evidence: AdminFarmEvidenceFileDto[];

  @ApiProperty({ type: [AdminFarmVerificationDto] })
  verifications: AdminFarmVerificationDto[];

  @ApiProperty({
    type: AdminFarmAssignedAgentDto,
    nullable: true,
    description: 'Agent whose cluster holds the farm, when it is clustered',
  })
  assignedAgent: AdminFarmAssignedAgentDto | null;
}

export class AdminFarmQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'amina',
    description:
      'Case-insensitive match on the farmer name, phone, farmer code, farm code or farm name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  stateId?: string;

  @ApiPropertyOptional({
    enum: FarmVerificationStatus,
    enumName: 'FarmVerificationStatus',
  })
  @IsOptional()
  @IsEnum(FarmVerificationStatus)
  status?: FarmVerificationStatus;
}

/** The six cards above the farmers directory. Not affected by list filters. */
export class AdminFarmSummaryDto {
  @ApiProperty({ type: 'integer' })
  totalFarmers: number;

  @ApiProperty({
    type: 'integer',
    description: 'Distinct states that have at least one farm',
  })
  stateCount: number;

  @ApiProperty({ type: 'integer' })
  verifiedFarms: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Nearest percent of farms that are VERIFIED. 0 when there are no farms',
  })
  verificationRate: number;

  @ApiProperty({
    type: 'integer',
    description: 'Farms whose verification status is PENDING',
  })
  awaitingReview: number;

  @ApiProperty({
    type: 'integer',
    description: 'Farms whose verification status is SUSPENDED',
  })
  suspendedFarms: number;

  @ApiProperty({
    type: 'integer',
    description: 'Clusters that contain at least one farm',
  })
  activeClusters: number;

  @ApiProperty({
    type: 'integer',
    description: 'Farms assigned to a cluster',
  })
  participatingFarms: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Distinct farm main produce, compared case-insensitively, ignoring blanks',
  })
  produceTypes: number;
}

export class SuspendedFarmerDto {
  @ApiProperty({ format: 'uuid', description: 'Farmer.id' })
  id: string;

  @ApiProperty({ enum: FarmerStatus, enumName: 'FarmerStatus' })
  status: FarmerStatus;

  @ApiProperty({
    type: 'integer',
    description: 'Farms set to SUSPENDED',
  })
  farmsSuspended: number;
}
