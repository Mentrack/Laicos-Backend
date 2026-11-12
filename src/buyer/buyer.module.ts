import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocationModule } from '../location/location.module';
import { AdminBuyerController } from './admin-buyer.controller';
import { BuyerController } from './buyer.controller';
import { BuyerService } from './buyer.service';

@Module({
  imports: [AuthModule, LocationModule],
  controllers: [BuyerController, AdminBuyerController],
  providers: [BuyerService],
})
export class BuyerModule {}
