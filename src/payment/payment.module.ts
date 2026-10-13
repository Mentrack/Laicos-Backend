import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FxModule } from '../fx/fx.module';
import { PayoutModule } from '../payout/payout.module';
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
import { PAYSTACK_EVENTS_QUEUE } from './paystack-events';
import { PaystackEventsProcessor } from './paystack-events.processor';
import { PaystackEventsService } from './paystack-events.service';
import { PaystackWebhookController } from './paystack-webhook.controller';
import { PaystackWebhookService } from './paystack-webhook.service';
import { RefundService } from './refund.service';

@Module({
  imports: [
    AuthModule,
    FxModule,
    // PayoutModule never imports PaymentModule, so this can't go circular.
    PayoutModule,
    BullModule.registerQueue(
      { name: CHECKOUT_EXPIRY_QUEUE },
      {
        name: PAYSTACK_EVENTS_QUEUE,
        // Paystack never resends an event we answered 200, so this job is the
        // only copy: 12 exponential tries from 5s ride out a ~3h verify outage.
        defaultJobOptions: {
          attempts: 12,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86400 },
        },
      },
    ),
  ],
  controllers: [
    PaymentController,
    AdminPaymentController,
    PaystackWebhookController,
  ],
  providers: [
    CheckoutConfig,
    PaymentService,
    RefundService,
    CheckoutExpiryService,
    CheckoutExpiryProcessor,
    CheckoutExpiryScheduler,
    PaystackWebhookService,
    PaystackEventsService,
    PaystackEventsProcessor,
  ],
  exports: [CheckoutConfig],
})
export class PaymentModule {}
