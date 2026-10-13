import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requireConfig } from '../common/config';

@Injectable()
export class PaystackConfig {
  readonly secretKey: string;
  // Where Paystack sends the buyer after paying.
  readonly callbackUrl: string;

  constructor(config: ConfigService) {
    this.secretKey = requireConfig(config, 'PAYSTACK_SECRET_KEY');
    this.callbackUrl = requireConfig(config, 'PAYSTACK_CALLBACK_URL');
    if (!URL.canParse(this.callbackUrl)) {
      throw new Error('PAYSTACK_CALLBACK_URL must be a URL');
    }
  }
}
