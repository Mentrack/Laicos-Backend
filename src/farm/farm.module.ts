import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocationModule } from '../location/location.module';
import { VerificationModule } from '../verification/verification.module';
import { FarmController } from './farm.controller';
import { FarmProfileService } from './services/farm-profile.service';
import { FarmService } from './services/farm.service';
import { FarmerRegistrationService } from './services/farmer-registration.service';
import { FarmerService } from './services/farmer.service';

@Module({
  imports: [AuthModule, LocationModule, VerificationModule],
  controllers: [FarmController],
  providers: [
    FarmService,
    FarmProfileService,
    FarmerService,
    FarmerRegistrationService,
  ],
  // Agent onboarding registers farmers the same way self-signup does.
  exports: [FarmerRegistrationService],
})
export class FarmModule {}
