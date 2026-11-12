import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../generated/client';
import { AuthSessionDto } from '../auth/dto';
import { ApiEnvelope } from '../common/dto/envelope';
import { AcceptInviteDto } from '../invite/dto';
import { InviteService } from '../invite/invite.service';

@Controller('agents/invites')
@ApiTags('Agents')
export class AgentInviteController {
  constructor(private readonly invites: InviteService) {}

  // Public: the invite token is the credential.
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an agent invite',
    description:
      'Creates the agent account for the invited email and signs it in with the email already verified; they complete their application next. 400 INVITE_INVALID when the link is unknown or already used, 400 INVITE_EXPIRED when it has expired, 409 when the email already has an account.',
  })
  @ApiEnvelope(AuthSessionDto)
  async accept(@Body() dto: AcceptInviteDto) {
    const data = await this.invites.accept(dto, Role.EXTENSION_AGENT);
    return { data, message: 'Agent account created' };
  }
}
