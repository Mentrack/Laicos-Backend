import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HandoverController } from './handover.controller';
import { HandoverService } from './handover.service';

@Module({
  imports: [AuthModule],
  controllers: [HandoverController],
  providers: [HandoverService],
})
export class HandoverModule {}
