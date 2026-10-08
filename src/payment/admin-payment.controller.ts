import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { PaymentDto } from './dto';
import { PaymentService } from './payment.service';

@Controller('admin/payments')
@ApiTags('Payments')
export class AdminPaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post(':reference/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm a payment by hand',
    description:
      'For bank transfers seen in the escrow account (and, until a card provider is integrated, card payments). Marks the checkout PAID and releases its orders to the farmers. Repeating it returns the payment. 409 CHECKOUT_EXPIRED if the checkout expired first: refund the buyer.',
  })
  @Auth(Role.ADMIN)
  @ApiEnvelope(PaymentDto)
  async confirm(
    @CurrentUser() user: User,
    @Param('reference') reference: string,
  ) {
    const data = await this.payments.confirm(reference, user);
    return { data, message: 'Payment confirmed' };
  }
}
