import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InviteService } from './invite.service';

@Module({
  imports: [AuthModule],
  providers: [InviteService],
  exports: [InviteService],
})
export class InviteModule {}
