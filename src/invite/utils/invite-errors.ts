import { BadRequestException } from '@nestjs/common';

export function inviteInvalidError(): BadRequestException {
  return new BadRequestException({
    message: 'This invite link is invalid or has already been used',
    code: 'INVITE_INVALID',
  });
}

export function inviteExpiredError(): BadRequestException {
  return new BadRequestException({
    message: 'This invite link has expired. Ask an admin to resend it',
    code: 'INVITE_EXPIRED',
  });
}
