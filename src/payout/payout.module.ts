import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminPayoutController } from './admin-payout.controller';
import { BankAccountController } from './bank-account.controller';
import { BankAccountService } from './bank-account.service';
import { PayoutConfig } from './payout.config';
import { PayoutController } from './payout.controller';
import {
  PAYOUTS_QUEUE,
  PayoutRunProcessor,
  PayoutRunScheduler,
} from './payout-run.processor';
import { PayoutRunService } from './payout-run.service';
import { PayoutService } from './payout.service';

@Module({
  imports: [AuthModule, BullModule.registerQueue({ name: PAYOUTS_QUEUE })],
  controllers: [BankAccountController, AdminPayoutController, PayoutController],
  providers: [
    BankAccountService,
    PayoutConfig,
    PayoutService,
    PayoutRunService,
    PayoutRunProcessor,
    PayoutRunScheduler,
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
