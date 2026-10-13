import { Body, Controller, Get, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { PaginationQueryDto } from '../common/pagination';
import {
  ApprovePayoutsDto,
  EligiblePayoutDto,
  PayoutBatchDto,
  PayoutDto,
  PayoutQueryDto,
} from './dto';
import { PayoutService } from './payout.service';

@Controller('admin/payouts')
@ApiTags('Payouts')
@Auth(Role.ADMIN)
export class AdminPayoutController {
  constructor(private readonly payouts: PayoutService) {}

  @Get('eligible')
  @ApiOperation({
    summary: 'List farmers due a payout',
    description:
      'One row per farmer whose FULFILLED, paid orders are past PAYOUT_HOLD_HOURS and not yet paid out, and whose bank account has been unchanged for 24h. Check accountName against the farmer before approving.',
  })
  @ApiEnvelope(EligiblePayoutDto, { paginated: true })
  async findEligible(@Query() query: PaginationQueryDto) {
    const { data, metaData } = await this.payouts.findEligible(query);
    return { data, message: 'Eligible payouts retrieved', metaData };
  }

  @Post()
  @ApiOperation({
    summary: 'Pay farmers',
    description:
      'One NGN transfer per farmer for all their eligible orders, sent in one Paystack bulk transfer from the balance. Payouts start PENDING and settle by webhook (SUCCEEDED, FAILED or REVERSED; the last two free the orders to be paid again). Farmers with nothing eligible are returned in skippedFarmerIds.',
  })
  @ApiEnvelope(PayoutBatchDto, { status: HttpStatus.CREATED })
  async approve(@CurrentUser() user: User, @Body() dto: ApprovePayoutsDto) {
    const data = await this.payouts.approve(user, dto);
    return { data, message: 'Payouts sent' };
  }

  @Get()
  @ApiOperation({ summary: 'List payouts', description: 'Newest first.' })
  @ApiEnvelope(PayoutDto, { paginated: true })
  async findAll(@Query() query: PayoutQueryDto) {
    const { data, metaData } = await this.payouts.findAll(query);
    return { data, message: 'Payouts retrieved', metaData };
  }
}
