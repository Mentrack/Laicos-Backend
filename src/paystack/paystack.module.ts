import { Global, Module } from '@nestjs/common';
import { PaystackClient } from './paystack.client';
import { PaystackConfig } from './paystack.config';

@Global()
@Module({
  providers: [PaystackConfig, PaystackClient],
  exports: [PaystackConfig, PaystackClient],
})
export class PaystackModule {}
