import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminPaymentController } from './admin-payment.controller';
import { CheckoutConfig } from './checkout-config';
import {
  CHECKOUT_EXPIRY_QUEUE,
  CheckoutExpiryProcessor,
  CheckoutExpiryScheduler,
} from './checkout-expiry.processor';
import { CheckoutExpiryService } from './checkout-expiry.service';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PAYMENT_PROVIDER } from './providers/payment-provider';
import { StubPaymentProvider } from './providers/stub-payment.provider';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({ name: CHECKOUT_EXPIRY_QUEUE }),
  ],
  controllers: [PaymentController, AdminPaymentController],
  providers: [
    CheckoutConfig,
    PaymentService,
    CheckoutExpiryService,
    CheckoutExpiryProcessor,
    CheckoutExpiryScheduler,
    { provide: PAYMENT_PROVIDER, useClass: StubPaymentProvider },
  ],
  exports: [CheckoutConfig],
})
export class PaymentModule {}
