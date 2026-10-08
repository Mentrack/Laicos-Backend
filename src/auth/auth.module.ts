import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { FarmerActivationService } from './farmer-activation.service';
import { FarmerInviteService } from './farmer-invite.service';
import { FirebaseService } from './firebase/firebase.service';

@Module({
  providers: [
    AuthService,
    FirebaseService,
    FarmerInviteService,
    FarmerActivationService,
  ],
  controllers: [AuthController],
  // Modules using @Auth import AuthModule: the guards resolve FirebaseService there.
  // AuthService: farmer signup and onboarding create accounts.
  // FarmerActivationService: verification decisions activate farmers.
  exports: [FirebaseService, AuthService, FarmerActivationService],
})
export class AuthModule {}
