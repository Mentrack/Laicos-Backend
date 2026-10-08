import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { CheckoutService } from './checkout.service';
import { CheckoutDto } from './dto';

@Controller('checkouts')
@ApiTags('Cart')
export class CheckoutController {
  constructor(private readonly checkouts: CheckoutService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Get a checkout and its orders',
    description: 'Buyers see their own; admins see any.',
  })
  @Auth(Role.BUYER, Role.ADMIN)
  @ApiEnvelope(CheckoutDto)
  async findOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.checkouts.findOne(user, id);
    return { data, message: 'Checkout retrieved' };
  }
}
