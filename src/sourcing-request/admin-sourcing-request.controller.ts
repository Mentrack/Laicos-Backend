import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../generated/client';
import { AuditService } from '../audit/audit.service';
import { AuditEventDto } from '../audit/dto/audit-event.dto';
import { Auth } from '../auth/decorators/auth.decorator';
import { CreateCheckoutDto } from '../cart/dto';
import { CheckoutDto } from '../cart/dto/checkout.dto';
import { IdempotencyKey, idempotencyKeyPipe } from '../common/idempotency-key';
import { ApiEnvelope } from '../common/dto/envelope';
import { PaginationQueryDto } from '../common/pagination';
import { AdminSourcingRequestService } from './admin-sourcing-request.service';
import {
  AdminAllocationDto,
  AdminSourcingQueryDto,
  AdminSourcingRowDto,
  AdminSourcingSummaryDto,
  AssignAgentDto,
  CloseSourcingRequestDto,
  SaveAllocationsDto,
} from './dto/admin-sourcing-request.dto';

@Controller('admin/sourcing-requests')
@ApiTags('Sourcing Requests')
@Auth(Role.ADMIN)
export class AdminSourcingRequestController {
  constructor(
    private readonly requests: AdminSourcingRequestService,
    private readonly audit: AuditService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Count buyer requests by stage',
    description:
      'The cards above the list. Not affected by the list search or status filter.',
  })
  @ApiEnvelope(AdminSourcingSummaryDto)
  async summary() {
    const data = await this.requests.summary();
    return { data, message: 'Sourcing summary retrieved' };
  }

  @Get()
  @ApiOperation({
    summary: 'List buyer requests',
    description:
      'Newest first. Search matches the request number, the buyer display name, or the produce name.',
  })
  @ApiEnvelope(AdminSourcingRowDto, { paginated: true })
  async findAll(@Query() query: AdminSourcingQueryDto) {
    const { data, metaData } = await this.requests.findAll(query);
    return { data, message: 'Sourcing requests retrieved', metaData };
  }

  @Get(':id/listings')
  @ApiOperation({
    summary: 'List eligible listings for a request',
    description:
      'Published listings on verified farms in the assigned agent’s cluster whose name and unit match. 409 before an agent is assigned. 404 when the request is missing.',
  })
  @ApiEnvelope(AdminAllocationDto, { list: true })
  async listings(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.requests.listings(id);
    return { data, message: 'Eligible listings retrieved' };
  }

  @Get(':id/audit')
  @ApiOperation({
    summary: 'List the audit for a buyer request',
    description: '{id} is the sourcing request. Newest first. 404 when it is missing.',
  })
  @ApiEnvelope(AuditEventDto, { paginated: true })
  async auditLog(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    const { data, metaData } = await this.audit.findForRequest(id, query);
    return { data, message: 'Audit log retrieved', metaData };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a buyer request',
    description:
      'The request, the buyer, the assigned agent, the saved group, coverage, the live checkout, its orders, and the newest five audit rows. 404 when it is missing.',
  })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.requests.findOne(id);
    return { data, message: 'Sourcing request retrieved' };
  }

  @Post(':id/assignment')
  @ApiOperation({
    summary: 'Assign or reassign the agent',
    description:
      'The agent must be verified. Refused once a checkout exists, or when the saved listings sit outside the new agent’s cluster.',
  })
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignAgentDto,
  ) {
    const data = await this.requests.assign(id, dto);
    return { data, message: 'Agent assigned' };
  }

  @Put(':id/allocations')
  @ApiOperation({
    summary: 'Replace the saved listing group',
    description:
      'Does not reserve stock. An empty list clears the group. Refused once a checkout is awaiting payment or paid.',
  })
  async save(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveAllocationsDto,
  ) {
    const data = await this.requests.save(id, dto);
    return { data, message: 'Selection saved' };
  }

  @Post(':id/confirm')
  @ApiOperation({
    summary: 'Confirm the group and place one checkout',
    description:
      'One order per selected listing, at that listing’s price. The buyer’s cart is left alone. The same Idempotency-Key returns the original checkout.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiEnvelope(CheckoutDto)
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @IdempotencyKey(idempotencyKeyPipe()) idempotencyKey: string,
    @Body() dto: CreateCheckoutDto,
  ) {
    const data = await this.requests.confirm(id, idempotencyKey, dto);
    return { data, message: 'Supply confirmed' };
  }

  @Post(':id/escalate')
  @ApiOperation({
    summary: 'Mark a request escalated',
    description: 'Sets the time and does not change the status. A second call changes nothing.',
  })
  async escalate(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.requests.escalate(id);
    return { data, message: 'Request escalated' };
  }

  @Post(':id/close')
  @ApiOperation({
    summary: 'Close a request',
    description:
      'Releases an unpaid checkout. Refused while a paid order is still open, or when the request is completed or already closed.',
  })
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseSourcingRequestDto,
  ) {
    const data = await this.requests.close(id, dto);
    return { data, message: 'Request closed' };
  }
}
