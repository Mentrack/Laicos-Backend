import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaystackWebhookService } from './paystack-webhook.service';

// Called by Paystack, not the webapp: signed instead of authenticated.
@Controller('webhooks/paystack')
@ApiExcludeController()
export class PaystackWebhookController {
  constructor(private readonly webhooks: PaystackWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string | undefined,
  ) {
    await this.webhooks.enqueue(request.rawBody, signature);
    return { data: null, message: 'Received' };
  }
}
