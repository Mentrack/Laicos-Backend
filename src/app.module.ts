import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { requireConfig } from './common/config';
import { FarmModule } from './farm/farm.module';
import { HandoverModule } from './handover/handover.module';
import { OrderModule } from './order/order.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProduceModule } from './produce/produce.module';
import { StorageModule } from './storage/storage.module';
import { AgentModule } from './agent/agent.module';
import { LocationModule } from './location/location.module';
import { MailModule } from './mail/mail.module';
import { VerificationModule } from './verification/verification.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, expandVariables: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const port = Number(requireConfig(config, 'REDIS_PORT'));
        if (!Number.isInteger(port)) {
          throw new Error('REDIS_PORT must be an integer');
        }
        return {
          connection: {
            host: requireConfig(config, 'REDIS_HOST'),
            port,
            password: requireConfig(config, 'REDIS_PASSWORD'),
          },
          // Every queue shares these; a queue overrides only what it must.
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 86400 },
          },
        };
      },
    }),
    PrismaModule,
    MailModule,
    AuthModule,
    FarmModule,
    ProduceModule,
    OrderModule,
    StorageModule,
    AgentModule,
    LocationModule,
    VerificationModule,
    HandoverModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
