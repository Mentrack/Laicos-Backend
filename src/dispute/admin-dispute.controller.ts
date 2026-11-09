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
import { ApiEnvelope } from '../common/dto/envelope';
import { DisputeService } from './dispute.service';
import { DisputeDto, DisputeQueryDto, ResolveDisputeDto } from './dto';

@Controller('admin/disputes')
@ApiTags('Disputes')
@Auth(Role.ADMIN)
export class AdminDisputeController {
  constructor(private readonly disputes: DisputeService) {}

  @Get()
  @ApiOperation({
    summary: 'List disputes',
    description: 'Oldest first. Filter by status, e.g. OPEN for the queue.',
  })
  @ApiEnvelope(DisputeDto, { paginated: true })
  async findAll(@Query() query: DisputeQueryDto) {
    const { data, metaData } = await this.disputes.findAll(query);
    return { data, message: 'Disputes retrieved', metaData };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a dispute' })
  @ApiEnvelope(DisputeDto)
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.disputes.findOne(id);
    return { data, message: 'Dispute retrieved' };
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve a dispute',
    description:
      'refundPercent (0–100, 2 dp) of what the buyer paid for the order goes back to them through Paystack; the farmer and agent are paid the rest by the next payout run once the refund is PROCESSED. 0 means solved without a refund. A SHIPPED order becomes FULFILLED. If the refund FAILS, re-issue it with POST /admin/payments/:reference/refunds and this orderId. 409 DISPUTE_RESOLVED, REFUND_EXCEEDS_BALANCE, PAYMENT_NOT_REFUNDABLE.',
  })
  @ApiEnvelope(DisputeDto)
  async resolve(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    const data = await this.disputes.resolve(user, id, dto);
    return { data, message: 'Dispute resolved' };
  }
}
