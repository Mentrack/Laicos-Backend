import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { IdentityDto, UpdateIdentityDto } from '../../common/dto/identity.dto';
import { LgaDto, StateDto } from '../../location/dto';

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
