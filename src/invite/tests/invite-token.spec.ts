import { hashInviteToken, newInviteToken } from '../utils/invite-token';

describe('invite token', () => {
  it('hashes to 64 hex characters', () => {
    expect(hashInviteToken('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a url-safe token and the hash of that token', () => {
    const { token, tokenHash } = newInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toBe(hashInviteToken(token));
  });
});
