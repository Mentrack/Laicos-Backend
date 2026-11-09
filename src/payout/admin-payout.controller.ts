import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { PayoutDto, PayoutQueryDto } from './dto';
import { PayoutService } from './payout.service';

@Controller('admin/payouts')
@ApiTags('Payouts')
@Auth(Role.ADMIN)
export class AdminPayoutController {
  constructor(private readonly payouts: PayoutService) {}

  @Get()
  @ApiOperation({
    summary: 'List payouts',
    description:
      'Newest first. Payouts are created automatically every PAYOUT_RUN_MINUTES, one per farmer (produce) or agent (commission), once the buyer has confirmed delivery and the dispute window has passed. FAILED payouts are retried on the next run; REVERSED ones only after the payee changes their bank account.',
  })
  @ApiEnvelope(PayoutDto, { paginated: true })
  async findAll(@Query() query: PayoutQueryDto) {
    const { data, metaData } = await this.payouts.findAll(query);
    return { data, message: 'Payouts retrieved', metaData };
  }
}
