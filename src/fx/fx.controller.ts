import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope } from '../common/dto/envelope';
import { FxRateDto } from './dto/fx-rate.dto';
import { FxService } from './fx.service';

@Controller('fx')
@ApiTags('FX')
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Get('rate')
  @ApiOperation({
    summary: 'Get the NGN per USD rate for dollar payments',
    description:
      'Public, so prices can be shown in USD. The margin is already applied. 409 FX_RATE_STALE when no recent rate is available.',
  })
  @ApiEnvelope(FxRateDto)
  async rate() {
    const data = await this.fx.currentRate();
    return { data, message: 'Rate retrieved' };
  }
}
