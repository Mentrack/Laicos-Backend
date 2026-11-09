import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentModule } from '../payment/payment.module';
import { PayoutConfig } from '../payout/payout.config';
import { AdminDisputeController } from './admin-dispute.controller';
import { DisputeController } from './dispute.controller';
import { DisputeService } from './dispute.service';

@Module({
  imports: [AuthModule, PaymentModule],
  controllers: [DisputeController, AdminDisputeController],
  providers: [DisputeService, PayoutConfig],
})
export class DisputeModule {}
