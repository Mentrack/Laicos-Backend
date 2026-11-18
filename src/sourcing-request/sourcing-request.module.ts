import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocationModule } from '../location/location.module';
import { PaymentModule } from '../payment/payment.module';
import { AdminSourcingRequestController } from './admin-sourcing-request.controller';
import { AdminSourcingRequestService } from './admin-sourcing-request.service';
import { AgentSourcingRequestController } from './agent-sourcing-request.controller';
import { AgentSourcingRequestService } from './agent-sourcing-request.service';
import { FarmerSourcingOfferController } from './farmer-sourcing-offer.controller';
import { FarmerSourcingOfferService } from './farmer-sourcing-offer.service';
import { SourcingConfig } from './sourcing-config';
import { SourcingContractService } from './sourcing-contract.service';
import { SourcingRequestController } from './sourcing-request.controller';
import { SourcingRequestService } from './sourcing-request.service';
import {
  SOURCING_RESPONSE_QUEUE,
  SourcingResponseProcessor,
  SourcingResponseScheduler,
} from './sourcing-response.processor';
import { SourcingResponseService } from './sourcing-response.service';

@Module({
  imports: [
    AuthModule,
    LocationModule,
    PaymentModule,
    BullModule.registerQueue({ name: SOURCING_RESPONSE_QUEUE }),
  ],
  controllers: [
    SourcingRequestController,
    AdminSourcingRequestController,
    AgentSourcingRequestController,
    FarmerSourcingOfferController,
  ],
  providers: [
    SourcingRequestService,
    AdminSourcingRequestService,
    AgentSourcingRequestService,
    FarmerSourcingOfferService,
    SourcingContractService,
    SourcingResponseService,
    SourcingResponseProcessor,
    SourcingResponseScheduler,
    SourcingConfig,
  ],
  exports: [SourcingConfig],
})
export class SourcingRequestModule {}
