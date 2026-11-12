import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CountDto } from '../common/dto/count.dto';
import { ApiEnvelope } from '../common/dto/envelope';
import { PaginationQueryDto } from '../common/pagination';
import { AdminFarmRowDto } from '../farm/dto/admin-farm.dto';
import { InviteByEmailDto, InviteDto, InviteQueryDto } from '../invite/dto';
import { InviteService } from '../invite/invite.service';
import { AdminAgentService } from './admin-agent.service';
import {
  AdminAgentDetailDto,
  AdminAgentListItemDto,
  AdminAgentLocationQueryDto,
  AdminAgentQueryDto,
  AdminAgentSummaryDto,
  PendingAgentDto,
  RejectAgentDto,
  SuspendAgentDto,
} from './dto';

@Controller('admin/agents')
@ApiTags('Agents')
@Auth(Role.ADMIN)
export class AdminAgentController {
  constructor(
    private readonly agents: AdminAgentService,
    private readonly invites: InviteService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List agents',
    description:
      'Every registered extension agent, newest first. Status: ONBOARDING has not completed the application (id and agentId are null), PENDING awaits approval, VERIFIED is approved, REJECTED is rejected. search is case-insensitive; every whitespace-separated term must match first name, last name, email or agent code. stateId and lgaId match the agent, or the application while onboarding. Filters AND together.',
  })
  @ApiEnvelope(AdminAgentListItemDto, { paginated: true })
  async findAll(@Query() query: AdminAgentQueryDto) {
    const { data, metaData } = await this.agents.findAll(query);
    return { data, message: 'Agents retrieved', metaData };
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Summarise agents',
    description:
      "Counts verified agents, their clusters, the farms in them and their open sourcing requests. stateId and lgaId match the agent's own State and LGA. earliestRequiredDate is the earliest required date among the open requests, overdue ones included, or null when there are none.",
  })
  @ApiEnvelope(AdminAgentSummaryDto)
  async summary(@Query() query: AdminAgentLocationQueryDto) {
    const data = await this.agents.summary(query);
    return { data, message: 'Agent summary retrieved' };
  }

  @Get('pending')
  @ApiOperation({
    summary: 'List agents awaiting approval',
    description:
      'Extension agents who completed their application and are neither verified nor rejected, oldest first.',
  })
  @ApiEnvelope(PendingAgentDto, { paginated: true })
  async findPending(@Query() query: PaginationQueryDto) {
    const { data, metaData } = await this.agents.findPending(query);
    return { data, message: 'Pending agents retrieved', metaData };
  }

  @Get('pending/count')
  @ApiOperation({
    summary: 'Count agents awaiting approval',
    description: 'The same agents as GET /admin/agents/pending.',
  })
  @ApiEnvelope(CountDto)
  async countPending() {
    const data = await this.agents.countPending();
    return { data, message: 'Pending agents counted' };
  }

  @Post('invites')
  @ApiOperation({
    summary: 'Invite an agent',
    description:
      'Emails a link, valid for 7 days, where they choose their name and password. 409 when the email is registered or already has a pending invite.',
  })
  @ApiEnvelope(InviteDto, { status: HttpStatus.CREATED })
  async invite(@CurrentUser() user: User, @Body() dto: InviteByEmailDto) {
    const data = await this.invites.invite(
      user,
      dto.email,
      Role.EXTENSION_AGENT,
    );
    return { data, message: 'Agent invited' };
  }

  @Get('invites')
  @ApiOperation({ summary: 'List agent invites' })
  @ApiEnvelope(InviteDto, { paginated: true })
  async findInvites(@Query() query: InviteQueryDto) {
    const { data, metaData } = await this.invites.findAll(
      query,
      Role.EXTENSION_AGENT,
    );
    return { data, message: 'Agent invites retrieved', metaData };
  }

  @Post('invites/:id/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resend an agent invite',
    description:
      'Issues a new link and invalidates the old one. 409 when the invite was accepted or the email now has an account.',
  })
  @ApiEnvelope(InviteDto)
  async resend(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.invites.resend(id, Role.EXTENSION_AGENT);
    return { data, message: 'Agent invite resent' };
  }

  // Declared after the `pending` and `invites` routes so they are not parsed as an id.
  @Get(':id')
  @ApiOperation({
    summary: 'Get an agent',
    description:
      '{id} is Agent.id. What the agent submitted on their application, with document links that expire in 15 minutes, and their verification status. 404 when the agent does not exist.',
  })
  @ApiEnvelope(AdminAgentDetailDto)
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.agents.findOne(id);
    return { data, message: 'Agent retrieved' };
  }

  @Get(':id/farms')
  @ApiOperation({
    summary: "List an agent's farms",
    description:
      "{id} is Agent.id. The farms in the agent's cluster, newest first; an empty page when the agent has no cluster. Rows are the same as GET /admin/farms. 404 when the agent does not exist.",
  })
  @ApiEnvelope(AdminFarmRowDto, { paginated: true })
  async findFarms(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    const { data, metaData } = await this.agents.findFarms(id, query);
    return { data, message: 'Agent farms retrieved', metaData };
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve an agent',
    description:
      'Verifies and activates a PENDING agent, so they get full access and farm verification work in their LGA, and emails them. 409 when the agent is already verified or rejected. 404 when the agent does not exist. A failed email does not undo the approval.',
  })
  @ApiEnvelope(AdminAgentDetailDto)
  async approve(
    @CurrentUser() admin: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.agents.approve(admin, id);
    return { data, message: 'Agent approved' };
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject an agent',
    description:
      'Rejects a PENDING agent with a reason and emails them the reason. Final: the agent stays locked out and cannot resubmit. 409 when the agent is already verified or rejected. 404 when the agent does not exist.',
  })
  @ApiEnvelope(AdminAgentDetailDto)
  async reject(
    @CurrentUser() admin: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectAgentDto,
  ) {
    const data = await this.agents.reject(admin, id, dto);
    return { data, message: 'Agent rejected' };
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suspend an agent',
    description:
      'Suspends a VERIFIED agent with a reason, until the optional end date or until unsuspended, and emails them. A suspended agent is locked out of the app. 400 when until is not in the future. 409 when the agent is already suspended or is not verified. 404 when the agent does not exist. A failed email does not undo the suspension.',
  })
  @ApiEnvelope(AdminAgentDetailDto)
  async suspend(
    @CurrentUser() admin: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendAgentDto,
  ) {
    const data = await this.agents.suspend(admin, id, dto);
    return { data, message: 'Agent suspended' };
  }

  @Post(':id/unsuspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unsuspend an agent',
    description:
      'Lifts a current suspension and emails the agent that their account is active again. 409 when the agent is not suspended. 404 when the agent does not exist. A failed email does not undo it.',
  })
  @ApiEnvelope(AdminAgentDetailDto)
  async unsuspend(
    @CurrentUser() admin: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.agents.unsuspend(admin, id);
    return { data, message: 'Agent unsuspended' };
  }
}
