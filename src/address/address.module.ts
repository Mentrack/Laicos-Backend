import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocationModule } from '../location/location.module';
import { AddressController } from './address.controller';
import { AddressService } from './address.service';

@Module({
  imports: [AuthModule, LocationModule],
  controllers: [AddressController],
  providers: [AddressService],
})
export class AddressModule {}
