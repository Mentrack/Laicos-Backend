import { Body, Controller, Get, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { AdminInviteService } from './admin-invite.service';
import { AdminService } from './admin.service';
import { AdminProfileDto, InviteAdminDto } from './dto';

@Controller('admins')
@ApiTags('Admins')
export class AdminController {
  constructor(
    private readonly admins: AdminService,
    private readonly invites: AdminInviteService,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get my admin profile',
    description: 'My public code. Name and email stay on GET /auth/me.',
  })
  @Auth(Role.ADMIN)
  @ApiEnvelope(AdminProfileDto)
  async findMine(@CurrentUser() user: User) {
    const data = await this.admins.findMine(user);
    return { data, message: 'Admin profile retrieved' };
  }

  @Post()
  @ApiOperation({
    summary: 'Invite an admin',
    description:
      'Creates their account with a temporary password and emails it. They must change that password before any other route. 409 when the email is registered.',
  })
  @Auth(Role.ADMIN)
  @ApiEnvelope(AdminProfileDto, { status: HttpStatus.CREATED })
  async invite(@Body() dto: InviteAdminDto) {
    const data = await this.invites.invite(dto);
    return { data, message: 'Admin invited' };
  }
}
