import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocationModule } from '../location/location.module';
import { VerificationModule } from '../verification/verification.module';
import { FarmController } from './farm.controller';
import { FarmService } from './services/farm.service';
import { FarmerService } from './services/farmer.service';

@Module({
  imports: [AuthModule, LocationModule, VerificationModule],
  controllers: [FarmController],
  providers: [FarmService, FarmerService],
})
export class FarmModule {}
