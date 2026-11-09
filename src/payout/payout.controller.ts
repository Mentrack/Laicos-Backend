import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { PaginationQueryDto } from '../common/pagination';
import { PayoutDto, PayoutSummaryDto } from './dto';
import { PayoutService } from './payout.service';

@Controller('payouts')
@ApiTags('Payouts')
@Auth(Role.FARMER, Role.EXTENSION_AGENT)
export class PayoutController {
  constructor(private readonly payouts: PayoutService) {}

  @Get()
  @ApiOperation({
    summary: 'List my payouts',
    description: 'Your SUCCEEDED payouts, newest first.',
  })
  @ApiEnvelope(PayoutDto, { paginated: true })
  async findMine(
    @CurrentUser() user: User,
    @Query() query: PaginationQueryDto,
  ) {
    const { data, metaData } = await this.payouts.findMine(user, query);
    return { data, message: 'Payouts retrieved', metaData };
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Get my total earnings',
    description:
      'The sum of your SUCCEEDED payouts: produce for a farmer, commission for an agent.',
  })
  @ApiEnvelope(PayoutSummaryDto)
  async summary(@CurrentUser() user: User) {
    const data = await this.payouts.summary(user);
    return { data, message: 'Payout summary retrieved' };
  }
}
