import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { SuspendedFarmerDto } from './dto';
import { AdminFarmService } from './services/admin-farm.service';

@Controller('admin/farmers')
@ApiTags('Farmers')
@Auth(Role.ADMIN)
export class AdminFarmerController {
  constructor(private readonly farms: AdminFarmService) {}

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suspend a farmer',
    description:
      '{id} is Farmer.id. Sets the farmer to DISABLED and every farm they own to SUSPENDED. 409 when any of those farms has an order in PENDING, CONFIRMED, PREPARING, READY or SHIPPED. Unpaid, cancelled and fulfilled orders do not block it. 404 when the farmer does not exist. A later approved verification sets that farm back to VERIFIED and the farmer back to ACTIVE.',
  })
  @ApiEnvelope(SuspendedFarmerDto)
  async suspend(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.farms.suspend(id);
    return { data, message: 'Farmer suspended' };
  }
}
