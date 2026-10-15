import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AddressModule } from './address/address.module';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { PaymentModule } from './payment/payment.module';
import { PayoutModule } from './payout/payout.module';
import { PaystackModule } from './paystack/paystack.module';
import { redisConnection } from './common/config';
import { FarmModule } from './farm/farm.module';
import { FxModule } from './fx/fx.module';
import { ConversationModule } from './conversation/conversation.module';
import { HandoverModule } from './handover/handover.module';
import { OrderModule } from './order/order.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProduceModule } from './produce/produce.module';
import { SourcingRequestModule } from './sourcing-request/sourcing-request.module';
import { StorageModule } from './storage/storage.module';
import { AdminModule } from './admin/admin.module';
import { AgentModule } from './agent/agent.module';
import { BuyerModule } from './buyer/buyer.module';
import { LocationModule } from './location/location.module';
import { MailModule } from './mail/mail.module';
import { VerificationModule } from './verification/verification.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, expandVariables: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: redisConnection(config),
        // Every queue shares these; a queue overrides only what it must.
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86400 },
        },
      }),
    }),
    PrismaModule,
    PaystackModule,
    FxModule,
    MailModule,
    AuthModule,
    FarmModule,
    ProduceModule,
    OrderModule,
    CartModule,
    PaymentModule,
    PayoutModule,
    SourcingRequestModule,
    StorageModule,
    AdminModule,
    AgentModule,
    BuyerModule,
    LocationModule,
    AddressModule,
    VerificationModule,
    HandoverModule,
    ConversationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
