import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SourcingRequestController } from './sourcing-request.controller';
import { SourcingRequestService } from './sourcing-request.service';

@Module({
  imports: [AuthModule],
  controllers: [SourcingRequestController],
  providers: [SourcingRequestService],
})
export class SourcingRequestModule {}
