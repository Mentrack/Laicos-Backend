import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '../../../generated/client';
import {
  emailNotVerifiedError,
  invalidVerificationCodeError,
  needsEmailVerification,
} from '../utils/email-verification';

describe('needsEmailVerification', () => {
  it.each([Role.BUYER, Role.RIDER])('is true for an unverified %s', (role) => {
    expect(needsEmailVerification({ role, isVerified: false })).toBe(true);
  });

  it('is false once verified', () => {
    expect(needsEmailVerification({ role: Role.BUYER, isVerified: true })).toBe(
      false,
    );
  });

  it.each([Role.FARMER, Role.EXTENSION_AGENT, Role.ADMIN])(
    'is false for %s, which has its own activation',
    (role) => {
      expect(needsEmailVerification({ role, isVerified: false })).toBe(false);
    },
  );
});

describe('email verification errors', () => {
  it('carries EMAIL_NOT_VERIFIED on a 403', () => {
    const error = emailNotVerifiedError();
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('carries INVALID_VERIFICATION_CODE on a 400', () => {
    const error = invalidVerificationCodeError();
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({
      message: 'Invalid or expired code',
      code: 'INVALID_VERIFICATION_CODE',
    });
  });
});
