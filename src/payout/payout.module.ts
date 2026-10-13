import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminPayoutController } from './admin-payout.controller';
import { BankAccountController } from './bank-account.controller';
import { BankAccountService } from './bank-account.service';
import { PayoutConfig } from './payout.config';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';

@Module({
  imports: [AuthModule],
  controllers: [BankAccountController, AdminPayoutController, PayoutController],
  providers: [BankAccountService, PayoutConfig, PayoutService],
  exports: [PayoutService],
})
export class PayoutModule {}
