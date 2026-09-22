import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { FirebaseService } from './firebase/firebase.service';

@Module({
  providers: [AuthService, FirebaseService],
  controllers: [AuthController],
  // Modules using @Auth import AuthModule: the guards resolve FirebaseService there.
  exports: [FirebaseService],
})
export class AuthModule {}
