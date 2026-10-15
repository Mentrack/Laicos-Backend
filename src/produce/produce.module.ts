import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  AdminProduceController,
  AdminFarmProduceController,
} from './admin-produce.controller';
import { AdminProduceService } from './admin-produce.service';
import { ProduceController } from './produce.controller';
import { ProduceService } from './produce.service';

@Module({
  imports: [AuthModule],
  controllers: [
    ProduceController,
    AdminProduceController,
    AdminFarmProduceController,
  ],
  providers: [ProduceService, AdminProduceService],
})
export class ProduceModule {}
