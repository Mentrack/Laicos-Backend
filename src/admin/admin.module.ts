import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { AdminInviteService } from './admin-invite.service';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminService, AdminInviteService],
})
export class AdminModule {}
