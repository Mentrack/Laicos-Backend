import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { PaginationQueryDto } from '../common/pagination';
import { PayoutDto } from './dto';
import { PayoutService } from './payout.service';

@Controller('payouts')
@ApiTags('Payouts')
export class PayoutController {
  constructor(private readonly payouts: PayoutService) {}

  @Get()
  @ApiOperation({ summary: 'List my payouts', description: 'Newest first.' })
  @Auth(Role.FARMER)
  @ApiEnvelope(PayoutDto, { paginated: true })
  async findMine(
    @CurrentUser() user: User,
    @Query() query: PaginationQueryDto,
  ) {
    const { data, metaData } = await this.payouts.findMine(user, query);
    return { data, message: 'Payouts retrieved', metaData };
  }
}
