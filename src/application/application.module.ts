import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FarmModule } from '../farm/farm.module';
import { LocationModule } from '../location/location.module';
import { ApplicationController } from './application.controller';
import { ApplicationService } from './application.service';

@Module({
  imports: [AuthModule, FarmModule, LocationModule],
  controllers: [ApplicationController],
  providers: [ApplicationService],
})
export class ApplicationModule {}
