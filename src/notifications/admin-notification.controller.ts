import {
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
import { Role } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { DeliveryService } from './delivery.service';
import { DeliveryQueryDto } from './dto/delivery-query.dto';
import { DeliveryDto } from './dto/delivery.dto';

@Controller('admin/notifications')
@ApiTags('Notifications')
@Auth(Role.ADMIN)
export class AdminNotificationController {
  constructor(private readonly deliveries: DeliveryService) {}

  @Get('deliveries')
  @ApiOperation({
    summary: 'List notification deliveries',
    description:
      'Dead-letter view: defaults to status=FAILED. Most recently updated first.',
  })
  @ApiEnvelope(DeliveryDto, { paginated: true })
  async list(@Query() query: DeliveryQueryDto) {
    const { data, metaData } = await this.deliveries.list(query);
    return { data, message: 'Deliveries retrieved', metaData };
  }

  @Post('deliveries/:id/retry')
  @ApiOperation({
    summary: 'Retry a failed delivery',
    description:
      'Resets a FAILED delivery to PENDING and re-queues it. 404 when it does not exist; 409 when it is not FAILED.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiEnvelope(DeliveryDto)
  async retry(@Param('id', ParseUUIDPipe) id: string) {
    return {
      data: await this.deliveries.retry(id),
      message: 'Delivery re-queued',
    };
  }
}
