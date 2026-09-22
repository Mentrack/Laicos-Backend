import type { Request } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { User } from '../../generated/client';

/** A request after the `@Auth` guard chain has run. */
export interface AuthenticatedRequest extends Request {
  firebaseUser: DecodedIdToken;
  user: User;
}
