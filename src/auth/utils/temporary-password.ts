import { randomBytes } from 'node:crypto';

/** 12 URL-safe characters (72 bits); one per invite, never a shared default. */
export function temporaryPassword(): string {
  return randomBytes(9).toString('base64url');
}
