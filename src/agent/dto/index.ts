import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
  PickType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { GoogleLoginDto, RegisterDto, UserDto } from '../../auth/dto';
import { CreateFarmDto, SignupContactDto } from '../../farm/dto';
import { IdentityDto, UpdateIdentityDto } from '../../common/dto/identity.dto';
import { PaginationQueryDto } from '../../common/pagination';
import { HandoverDto } from '../../handover/dto';
import { LgaDto, StateDto } from '../../location/dto';
import { VerificationSummaryDto } from '../../verification/dto';

export class ClusterSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, nullable: true, example: 'Gwagwalada Hub' })
  name: string | null;

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

// Multipart: the ID document travels as a file beside these fields. Country
// isn't asked: only Nigerian states and LGAs exist, so it stays NG.
class AgentSignupFieldsDto extends IntersectionType(
  SignupContactDto,
  UpdateIdentityDto,
) {
  @ApiProperty({ format: 'uuid', description: 'From GET /locations/states' })
  @IsUUID()
  stateId: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'From GET /locations/states/{stateId}/lgas; the farms I verify and manage are here',
  })
  @IsUUID()
  lgaId: string;
}

export class AgentSignupDto extends IntersectionType(
  AgentSignupFieldsDto,
  PickType(RegisterDto, ['email', 'firstName', 'lastName'] as const),
) {}

/** Google supplies the name and email. */
export class GoogleAgentSignupDto extends IntersectionType(
  AgentSignupFieldsDto,
  GoogleLoginDto,
) {}

export class RegisteredAgentDto {
  @ApiProperty({ type: UserDto })
  user: UserDto;

  @ApiProperty({ type: AgentProfileDto })
  agent: AgentProfileDto;
}
