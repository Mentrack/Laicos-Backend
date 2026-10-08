import { Module } from '@nestjs/common';
import { CheckoutConfig } from './checkout-config';

@Module({
  providers: [CheckoutConfig],
  exports: [CheckoutConfig],
})
export class PaymentModule {}
