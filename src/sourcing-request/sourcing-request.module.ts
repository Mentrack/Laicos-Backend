import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentModule } from '../payment/payment.module';
import { AdminSourcingRequestController } from './admin-sourcing-request.controller';
import { AdminSourcingRequestService } from './admin-sourcing-request.service';
import { SourcingRequestController } from './sourcing-request.controller';
import { SourcingRequestService } from './sourcing-request.service';

@Module({
  imports: [AuthModule, PaymentModule],
  controllers: [SourcingRequestController, AdminSourcingRequestController],
  providers: [SourcingRequestService, AdminSourcingRequestService],
})
export class SourcingRequestModule {}
