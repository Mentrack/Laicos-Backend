import { createHash, randomBytes } from 'node:crypto';

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The raw token is emailed once; only its hash is stored. */
export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}
