import {
  Body,
  Controller,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { IdempotencyKey, idempotencyKeyPipe } from '../common/idempotency-key';
import { InitiatePaymentDto, PaymentDto } from './dto';
import { PaymentService } from './payment.service';

@Controller('checkouts')
@ApiTags('Payments')
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post(':id/payments')
  @ApiOperation({
    summary: 'Pay my checkout',
    description:
      'Starts a payment attempt for the checkout total, abandoning any earlier one. BANK_TRANSFER returns the escrow account and the reference to quote, and extends the hold to BANK_TRANSFER_HOLD_HOURS. Nothing is charged yet: an admin confirms payments. 409 CHECKOUT_NOT_PAYABLE once paid, expired, cancelled or past expiresAt.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'A UUID the client generates once per payment attempt',
  })
  @Auth(Role.BUYER)
  @ApiEnvelope(PaymentDto, { status: HttpStatus.CREATED })
  async initiate(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @IdempotencyKey(idempotencyKeyPipe()) idempotencyKey: string,
    @Body() dto: InitiatePaymentDto,
  ) {
    const data = await this.payments.initiate(user, id, idempotencyKey, dto);
    return { data, message: 'Payment started' };
  }
}
