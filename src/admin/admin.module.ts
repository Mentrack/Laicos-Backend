import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InviteModule } from '../invite/invite.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, InviteModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
