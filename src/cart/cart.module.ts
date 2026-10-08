import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentModule } from '../payment/payment.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

@Module({
  imports: [AuthModule, PaymentModule],
  controllers: [CartController, CheckoutController],
  providers: [CartService, CheckoutService],
})
export class CartModule {}
