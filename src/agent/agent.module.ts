import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocationModule } from '../location/location.module';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';

@Module({
  imports: [AuthModule, LocationModule],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}
