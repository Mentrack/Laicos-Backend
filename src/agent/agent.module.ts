import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FarmModule } from '../farm/farm.module';
import { LocationModule } from '../location/location.module';
import { AgentRegistrationService } from './agent-registration.service';
import { AgentSignupController } from './agent-signup.controller';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { FarmerOnboardingService } from './farmer-onboarding.service';

@Module({
  imports: [AuthModule, FarmModule, LocationModule],
  controllers: [AgentSignupController, AgentController],
  providers: [AgentService, AgentRegistrationService, FarmerOnboardingService],
})
export class AgentModule {}
