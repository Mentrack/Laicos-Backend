import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

@Module({
  imports: [AuthModule],
  controllers: [OrderController],
  providers: [OrderService],
})
export class OrderModule {}
