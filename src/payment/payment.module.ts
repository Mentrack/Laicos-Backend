import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminPaymentController } from './admin-payment.controller';
import { CheckoutConfig } from './checkout-config';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PAYMENT_PROVIDER } from './providers/payment-provider';
import { StubPaymentProvider } from './providers/stub-payment.provider';

@Module({
  imports: [AuthModule],
  controllers: [PaymentController, AdminPaymentController],
  providers: [
    CheckoutConfig,
    PaymentService,
    { provide: PAYMENT_PROVIDER, useClass: StubPaymentProvider },
  ],
  exports: [CheckoutConfig],
})
export class PaymentModule {}
