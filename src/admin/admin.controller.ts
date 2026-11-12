import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthSessionDto } from '../auth/dto';
import { ApiEnvelope } from '../common/dto/envelope';
import {
  AcceptInviteDto,
  InviteByEmailDto,
  InviteDto,
  InviteQueryDto,
} from '../invite/dto';
import { InviteService } from '../invite/invite.service';
import { AdminService } from './admin.service';
import { AdminProfileDto } from './dto';

@Controller('admins')
@ApiTags('Admins')
export class AdminController {
  constructor(
    private readonly admins: AdminService,
    private readonly invites: InviteService,
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
      'Emails a link, valid for 7 days, where they choose their name and password. 409 when the email is registered or already has a pending invite.',
  })
  @Auth(Role.ADMIN)
  @ApiEnvelope(InviteDto, { status: HttpStatus.CREATED })
  async invite(@CurrentUser() user: User, @Body() dto: InviteByEmailDto) {
    const data = await this.invites.invite(user, dto.email, Role.ADMIN);
    return { data, message: 'Admin invited' };
  }

  @Get('invites')
  @ApiOperation({ summary: 'List admin invites' })
  @Auth(Role.ADMIN)
  @ApiEnvelope(InviteDto, { paginated: true })
  async findInvites(@Query() query: InviteQueryDto) {
    const { data, metaData } = await this.invites.findAll(query, Role.ADMIN);
    return { data, message: 'Admin invites retrieved', metaData };
  }

  // Public: the invite token is the credential.
  @Post('invites/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an admin invite',
    description:
      'Creates the admin account for the invited email and signs it in. 400 INVITE_INVALID when the link is unknown or already used, 400 INVITE_EXPIRED when it has expired, 409 when the email already has an account.',
  })
  @ApiEnvelope(AuthSessionDto)
  async accept(@Body() dto: AcceptInviteDto) {
    const data = await this.invites.accept(dto, Role.ADMIN);
    return { data, message: 'Admin account created' };
  }

  @Post('invites/:id/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resend an admin invite',
    description:
      'Issues a new link and invalidates the old one. 409 when the invite was accepted or the email now has an account.',
  })
  @Auth(Role.ADMIN)
  @ApiEnvelope(InviteDto)
  async resend(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.invites.resend(id, Role.ADMIN);
    return { data, message: 'Admin invite resent' };
  }
}
