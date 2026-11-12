import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CountDto } from '../common/dto/count.dto';
import { ApiEnvelope } from '../common/dto/envelope';
import { BuyerService } from './buyer.service';

@Controller('admin/buyers')
@ApiTags('Buyers')
@Auth(Role.ADMIN)
export class AdminBuyerController {
  constructor(private readonly buyers: BuyerService) {}

  @Get('count')
  @ApiOperation({
    summary: 'Count buyers',
    description: 'Every buyer on the platform, person and company.',
  })
  @ApiEnvelope(CountDto)
  async count() {
    const data = await this.buyers.count();
    return { data, message: 'Buyers counted' };
  }
}
