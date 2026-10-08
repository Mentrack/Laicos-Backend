import { ForbiddenException } from '@nestjs/common';
import { Role, type User } from '../../../generated/client';

// What each role waits on: a farmer's first farm verified by an agent, an
// agent verified by an admin.
const PENDING_MESSAGES: Partial<Record<Role, string>> = {
  [Role.FARMER]: 'Your farm is awaiting verification',
  [Role.EXTENSION_AGENT]: 'Your profile is awaiting verification',
};

/** A farmer or agent gets no access until they are verified. */
export function isPendingActivation(
  user: Pick<User, 'role' | 'activatedAt'>,
): boolean {
  return user.role in PENDING_MESSAGES && !user.activatedAt;
}

// A distinct code: the client shows the "awaiting verification" screen
// rather than a generic permission error.
export function verificationPendingError(role: Role): ForbiddenException {
  return new ForbiddenException({
    message: PENDING_MESSAGES[role] ?? 'Your account is awaiting verification',
    code: 'VERIFICATION_PENDING',
  });
}
