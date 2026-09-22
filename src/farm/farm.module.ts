import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FarmController } from './farm.controller';
import { FarmService } from './services/farm.service';
import { FarmerService } from './services/farmer.service';

@Module({
  imports: [AuthModule],
  controllers: [FarmController],
  providers: [FarmService, FarmerService],
})
export class FarmModule {}
