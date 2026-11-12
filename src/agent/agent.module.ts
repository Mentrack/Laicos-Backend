import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FarmModule } from '../farm/farm.module';
import { InviteModule } from '../invite/invite.module';
import { LocationModule } from '../location/location.module';
import { AdminAgentController } from './admin-agent.controller';
import { AdminAgentService } from './admin-agent.service';
import { AgentInviteController } from './agent-invite.controller';
import {
  AGENT_SUSPENSION_QUEUE,
  AgentSuspensionProcessor,
  AgentSuspensionScheduler,
} from './agent-suspension.processor';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { FarmerOnboardingService } from './farmer-onboarding.service';

@Module({
  imports: [
    AuthModule,
    FarmModule,
    InviteModule,
    LocationModule,
    BullModule.registerQueue({ name: AGENT_SUSPENSION_QUEUE }),
  ],
  controllers: [AgentController, AdminAgentController, AgentInviteController],
  providers: [
    AgentService,
    FarmerOnboardingService,
    AdminAgentService,
    AgentSuspensionProcessor,
    AgentSuspensionScheduler,
  ],
})
export class AgentModule {}
