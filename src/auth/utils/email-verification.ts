import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role, type User } from '../../../generated/client';

export const OTP_LENGTH = 4;
export const OTP_TTL_MINUTES = 10;

// Farmers and agents are gated by activation instead; Google users arrive
// verified.
const VERIFIED_EMAIL_ROLES: Role[] = [Role.BUYER, Role.RIDER];

export function needsEmailVerification(
  user: Pick<User, 'role' | 'isVerified'>,
): boolean {
  return VERIFIED_EMAIL_ROLES.includes(user.role) && !user.isVerified;
}

// A distinct code: the client opens the OTP screen rather than an error.
export function emailNotVerifiedError(): ForbiddenException {
  return new ForbiddenException({
    message: 'Verify your email to continue',
    code: 'EMAIL_NOT_VERIFIED',
  });
}

// One answer for wrong, expired and unknown, so verify can't enumerate
// accounts.
export function invalidVerificationCodeError(): BadRequestException {
  return new BadRequestException({
    message: 'Invalid or expired code',
    code: 'INVALID_VERIFICATION_CODE',
  });
}
