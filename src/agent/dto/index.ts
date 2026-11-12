import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
  PickType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { RegisterDto } from '../../auth/dto';
import { CreateFarmDto } from '../../farm/dto';
import { IdentityDto, UpdateIdentityDto } from '../../common/dto/identity.dto';
import { PaginationQueryDto } from '../../common/pagination';
import { Trimmed } from '../../common/dto/trimmed';
import { HandoverDto } from '../../handover/dto';
import { LgaDto, StateDto } from '../../location/dto';
import { VerificationSummaryDto } from '../../verification/dto';

export class ClusterSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, nullable: true, example: 'Gwagwalada Hub' })
  name: string | null;

  @ApiProperty({ example: 'CL-000018', description: 'Public cluster code' })
  clusterCode: string;

  @ApiProperty({ example: 12 })
  farmCount: number;
}

export class AgentProfileDto extends IdentityDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'AG-000044', description: 'Public agent code' })
  agentId: string;

  @ApiProperty({ example: 'NG' })
  country: string;

  @ApiProperty({ type: StateDto, nullable: true })
  state: StateDto | null;

  @ApiProperty({ type: LgaDto, nullable: true })
  lga: LgaDto | null;

  @ApiProperty({ description: 'Set by an admin' })
  isVerified: boolean;

  @ApiProperty({ type: Date, nullable: true })
  verifiedAt: Date | null;

  @ApiProperty({ type: ClusterSummaryDto })
  cluster: ClusterSummaryDto;
}

// Send stateId and lgaId together; either alone is checked against the
// stored other half.
export class UpdateAgentDto extends UpdateIdentityDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  stateId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Cannot change once the agent is verified',
  })
  @IsOptional()
  @IsUUID()
  lgaId?: string;
}

export enum AgentTaskType {
  FARM_VERIFICATION = 'FARM_VERIFICATION',
  ORDER_HANDOVER = 'ORDER_HANDOVER',
}

export class AgentTaskQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AgentTaskType, enumName: 'AgentTaskType' })
  @IsOptional()
  @IsEnum(AgentTaskType)
  type?: AgentTaskType;
}

// One of verification or handover is set, matching `type`.
export class AgentTaskDto {
  @ApiProperty({ enum: AgentTaskType, enumName: 'AgentTaskType' })
  type: AgentTaskType;

  @ApiProperty({
    format: 'uuid',
    description:
      'What the task’s own routes take: the verification id, or the order id for a handover',
  })
  id: string;

  @ApiProperty({ description: 'When the task was opened' })
  createdAt: Date;

  @ApiProperty({ type: VerificationSummaryDto, nullable: true })
  verification: VerificationSummaryDto | null;

  @ApiProperty({ type: HandoverDto, nullable: true })
  handover: HandoverDto | null;
}

// State and LGA are the agent's own, and the agent is the referral, so the
// agent sends only what the farmer tells them.
export class OnboardFarmDto extends PickType(CreateFarmDto, [
  'name',
  'location',
  'size',
  'unit',
  'mainProduce',
  'isExporting',
] as const) {}

export class OnboardFarmerDto extends PickType(RegisterDto, [
  'email',
  'firstName',
  'lastName',
] as const) {
  @ApiProperty({
    example: '+2348012345678',
    description: 'Phone number in E.164 format',
  })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({ type: OnboardFarmDto })
  @ValidateNested()
  @Type(() => OnboardFarmDto)
  farm: OnboardFarmDto;
}

export class ClusterFarmerDto {
  @ApiProperty({ format: 'uuid', description: 'Farmer.id' })
  id: string;

  @ApiProperty({ example: 'FRM-000123', description: 'Public farmer code' })
  farmerId: string;

  @ApiProperty({ example: 'Ada' })
  firstName: string;

  @ApiProperty({ example: 'Okafor' })
  lastName: string;

  @ApiProperty({ example: 'ada@example.com' })
  email: string;

  @ApiProperty({ example: '+2348012345678', nullable: true, type: String })
  phoneNumber: string | null;

  @ApiProperty({ example: 2, description: 'Their farms in my cluster' })
  farmCount: number;

  @ApiProperty()
  createdAt: Date;
}

export class PendingAgentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'AG-000044', description: 'Public agent code' })
  agentId: string;

  @ApiProperty({ example: 'Musa' })
  firstName: string;

  @ApiProperty({ example: 'Bello' })
  lastName: string;

  @ApiProperty({ example: 'musa@example.com' })
  email: string;

  @ApiProperty({ type: String, nullable: true, example: '+2348012345678' })
  phoneNumber: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ type: StateDto, nullable: true })
  state: StateDto | null;

  @ApiProperty({ type: LgaDto, nullable: true })
  lga: LgaDto | null;

  @ApiProperty({ description: 'When the agent completed their application' })
  submittedAt: Date;
}

// ONBOARDING is only on the list: the agent has no Agent row yet.
export enum AgentVerificationStatus {
  ONBOARDING = 'ONBOARDING',
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  SUSPENDED = 'SUSPENDED',
  REJECTED = 'REJECTED',
}

export class VerificationMixDto {
  @ApiProperty({ example: 3 })
  verified: number;

  @ApiProperty({ example: 1 })
  pending: number;

  @ApiProperty({ example: 0 })
  rejected: number;

  @ApiProperty({ example: 0 })
  suspended: number;
}

export class AdminAgentDetailDto extends IntersectionType(
  PendingAgentDto,
  IdentityDto,
) {
  @ApiProperty({ type: String, nullable: true })
  organisation: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned URL; expires in 15 min',
  })
  professionalCertificateUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned URL; expires in 15 min',
  })
  bankStatementUrl: string | null;

  @ApiProperty({
    example: 2,
    description: 'Of ID document, professional certificate, bank statement',
  })
  documentsUploaded: number;

  @ApiProperty({
    enum: AgentVerificationStatus,
    enumName: 'AgentVerificationStatus',
  })
  status: AgentVerificationStatus;

  @ApiProperty({ type: Date, nullable: true })
  verifiedAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  rejectedAt: Date | null;

  @ApiProperty({ type: String, nullable: true })
  rejectionReason: string | null;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'Null unless currently suspended',
  })
  suspendedAt: Date | null;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'Null when open-ended or not currently suspended',
  })
  suspendedUntil: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null unless currently suspended',
  })
  suspensionReason: string | null;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: "The agent's own latest recorded action, or null",
  })
  lastActivityAt: Date | null;

  @ApiProperty({
    type: VerificationMixDto,
    description: 'Farms in the cluster by verification status',
  })
  verificationMix: VerificationMixDto;

  @ApiProperty({ type: ClusterSummaryDto, nullable: true })
  cluster: ClusterSummaryDto | null;
}

export class RejectAgentDto {
  @ApiProperty({ maxLength: 200, example: 'The ID document is unreadable' })
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason: string;
}

export class SuspendAgentDto {
  @ApiProperty({ maxLength: 200, example: 'Repeated missed farm visits' })
  @Trimmed()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason: string;

  @ApiPropertyOptional({
    type: Date,
    description: 'Must be in the future. Omit to suspend until further notice.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  until?: Date;
}

export class AdminAgentLocationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  stateId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lgaId?: string;
}

export class AdminAgentQueryDto extends IntersectionType(
  PaginationQueryDto,
  AdminAgentLocationQueryDto,
) {
  @ApiPropertyOptional({
    maxLength: 100,
    description:
      'Every whitespace-separated term must match first name, last name, email or agent code',
  })
  @Trimmed()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: AgentVerificationStatus,
    enumName: 'AgentVerificationStatus',
  })
  @IsOptional()
  @IsEnum(AgentVerificationStatus)
  status?: AgentVerificationStatus;
}

export class AdminAgentListItemDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Agent.id for GET /admin/agents/{id}; null while onboarding',
  })
  id: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'AG-000044',
    description: 'Public agent code; null while onboarding',
  })
  agentId: string | null;

  @ApiProperty({ example: 'Halima' })
  firstName: string;

  @ApiProperty({ example: 'Bello' })
  lastName: string;

  @ApiProperty({ example: 'halima@example.com' })
  email: string;

  @ApiProperty({ type: String, nullable: true, example: '+2348012345678' })
  phoneNumber: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ type: StateDto, nullable: true })
  state: StateDto | null;

  @ApiProperty({ type: LgaDto, nullable: true })
  lga: LgaDto | null;

  @ApiProperty({
    enum: AgentVerificationStatus,
    enumName: 'AgentVerificationStatus',
  })
  status: AgentVerificationStatus;

  @ApiProperty({ example: 12, description: "Farms in the agent's clusters" })
  assignedFarms: number;

  @ApiProperty({ example: 1 })
  activeClusters: number;

  @ApiProperty({
    example: 3,
    description: 'Assigned sourcing requests not completed or closed',
  })
  pendingRequests: number;

  @ApiProperty()
  createdAt: Date;
}

export class AdminAgentSummaryDto {
  @ApiProperty({ example: 18, description: 'Verified agents' })
  activeAgents: number;

  @ApiProperty({ example: 18 })
  activeClusters: number;

  @ApiProperty({ example: 142, description: 'Farms in those clusters' })
  assignedFarms: number;

  @ApiProperty({
    example: 12,
    description: 'Sourcing requests assigned to them, not completed or closed',
  })
  pendingRequests: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Earliest required date among those requests, overdue ones included',
  })
  earliestRequiredDate: Date | null;
}
