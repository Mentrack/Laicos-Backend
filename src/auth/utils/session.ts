import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { User } from '../../../generated/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { FirebaseService } from '../firebase/firebase.service';
import {
  emailNotVerifiedError,
  needsEmailVerification,
} from './email-verification';
import {
  isPendingActivation,
  verificationPendingError,
} from './pending-access';

// Shared by the @Auth guards and the chat gateway's handshake, so a socket is
// refused exactly when a request would be.

export async function verifySessionToken(
  firebase: FirebaseService,
  token: string,
): Promise<DecodedIdToken> {
  try {
    // checkRevoked: logout revokes refresh tokens, and without this an
    // already-issued ID token would keep working until it expires.
    return await firebase.auth.verifyIdToken(token, true);
  } catch {
    throw new UnauthorizedException('Invalid or expired token');
  }
}

export async function requireLocalUser(
  database: PrismaService,
  firebaseUid: string,
): Promise<User> {
  const user = await database.user.findUnique({ where: { firebaseUid } });
  if (!user) {
    throw new ForbiddenException('Complete registration first');
  }
  return user;
}

export function assertActivated(
  user: Pick<User, 'role' | 'activatedAt' | 'isVerified'>,
): void {
  if (isPendingActivation(user)) {
    throw verificationPendingError(user.role);
  }
  if (needsEmailVerification(user)) {
    throw emailNotVerifiedError();
  }
}

// A distinct code: the client routes it to the change-password screen rather
// than treating it as a role error.
export function passwordChangeRequiredError(): ForbiddenException {
  return new ForbiddenException({
    message: 'Change your password to continue',
    code: 'PASSWORD_CHANGE_REQUIRED',
  });
}
