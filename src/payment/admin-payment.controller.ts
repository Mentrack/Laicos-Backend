import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { CreateRefundDto, PaymentDto, RefundDto } from './dto';
import { PaymentService } from './payment.service';
import { RefundService } from './refund.service';

@Controller('admin/payments')
@ApiTags('Payments')
export class AdminPaymentController {
  constructor(
    private readonly payments: PaymentService,
    private readonly refunds: RefundService,
  ) {}

  @Post(':reference/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-check a payment with Paystack',
    description:
      "For a missed webhook (or local dev without one). Applies Paystack's answer exactly as the webhook would: a successful charge pays the checkout; money that can no longer be applied (checkout expired, cancelled or already paid, or the amount differs) becomes ORPHANED and is refunded automatically. Repeating it returns the payment. 409 PAYMENT_PROVIDER_UNAVAILABLE when Paystack is down.",
  })
  @Auth(Role.ADMIN)
  @ApiEnvelope(PaymentDto)
  async verify(
    @CurrentUser() user: User,
    @Param('reference') reference: string,
  ) {
    const data = await this.payments.verify(user, reference);
    return { data, message: 'Payment verified' };
  }

  @Post(':reference/refunds')
  @ApiOperation({
    summary: 'Refund a payment',
    description:
      "The payment must be SUCCEEDED; an ORPHANED payment can only have its balance refunded (to retry a failed automatic refund). With orderId: a CANCELLED order on this payment, refunded its price plus its share of the service fee (delivery is not refunded). Without: the payment's remaining balance, refused while any order on the checkout has a pending or paid payout. Paid back in the payment's currency through Paystack; status becomes PROCESSED when Paystack confirms, or FAILED if Paystack refuses (ask again to retry). An unknown outcome stays PENDING until Paystack reports it. 409 PAYMENT_NOT_REFUNDABLE, ORDER_NOT_REFUNDABLE, ORDER_ALREADY_REFUNDED, NOTHING_TO_REFUND, REFUND_EXCEEDS_BALANCE, ORDERS_PAID_OUT.",
  })
  @Auth(Role.ADMIN)
  @ApiEnvelope(RefundDto, { status: HttpStatus.CREATED })
  async refund(
    @CurrentUser() user: User,
    @Param('reference') reference: string,
    @Body() dto: CreateRefundDto,
  ) {
    const data = await this.refunds.refund(user, reference, dto);
    return { data, message: 'Refund requested' };
  }
}
