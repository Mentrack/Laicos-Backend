import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { FarmerStatus, Role, type User } from '../../../generated/client';
import { isCurrentlySuspended } from '../../agent/utils/agent-suspension';
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

/** Farmers are held by DISABLED status, extension agents by a live suspension. */
export async function assertAccountInGoodStanding(
  database: PrismaService,
  user: Pick<User, 'id' | 'role'>,
): Promise<void> {
  if (!(await isSuspended(database, user))) return;
  throw new ForbiddenException({
    message: 'Your account is suspended',
    code: 'ACCOUNT_SUSPENDED',
  });
}

async function isSuspended(
  database: PrismaService,
  user: Pick<User, 'id' | 'role'>,
): Promise<boolean> {
  if (user.role === Role.FARMER) {
    const farmer = await database.farmer.findUnique({
      where: { userId: user.id },
      select: { status: true },
    });
    return farmer?.status === FarmerStatus.DISABLED;
  }
  if (user.role === Role.EXTENSION_AGENT) {
    const agent = await database.agent.findUnique({
      where: { userId: user.id },
      select: { suspendedAt: true, suspendedUntil: true },
    });
    return agent !== null && isCurrentlySuspended(agent);
  }
  return false;
}
