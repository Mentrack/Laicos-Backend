import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { AuditService } from './audit.service';
import { AuditEventDto } from './dto/audit-event.dto';
import { AuditQueryDto } from './dto/audit-query.dto';

@Controller('admin')
@ApiTags('Audit')
@Auth(Role.ADMIN)
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('farmers/:id/audit')
  @ApiOperation({
    summary: 'List audit events for a farmer',
    description:
      '{id} is Farmer.id. Newest first. Optional farmId limits to events tied to that farm; the farm must belong to the farmer. 404 when the farmer or farm does not exist.',
  })
  @ApiEnvelope(AuditEventDto, { paginated: true })
  async farmerAudit(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AuditQueryDto,
  ) {
    const { data, metaData } = await this.audit.findForFarmer(id, query);
    return { data, message: 'Audit log retrieved', metaData };
  }

  @Get('agents/:id/audit')
  @ApiOperation({
    summary: 'List audit events for an agent',
    description:
      '{id} is Agent.id. Newest first. Optional farmId limits to events tied to that farm. 404 when the agent or farm does not exist.',
  })
  @ApiEnvelope(AuditEventDto, { paginated: true })
  async agentAudit(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AuditQueryDto,
  ) {
    const { data, metaData } = await this.audit.findForAgent(id, query);
    return { data, message: 'Audit log retrieved', metaData };
  }
}
