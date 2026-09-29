import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  ASSIGNMENT_QUEUE,
  AssignmentProcessor,
  AssignmentScheduler,
} from './assignment.processor';
import { AssignmentService } from './services/assignment.service';
import { VerificationService } from './services/verification.service';
import { VerificationController } from './verification.controller';

@Module({
  imports: [AuthModule, BullModule.registerQueue({ name: ASSIGNMENT_QUEUE })],
  controllers: [VerificationController],
  providers: [
    AssignmentService,
    VerificationService,
    AssignmentProcessor,
    AssignmentScheduler,
  ],
  // FarmModule opens rounds when farms are created or changed.
  exports: [AssignmentService],
})
export class VerificationModule {}
