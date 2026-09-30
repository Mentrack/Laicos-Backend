import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
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
