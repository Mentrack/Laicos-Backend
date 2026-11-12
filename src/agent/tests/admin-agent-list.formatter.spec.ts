import { AgentVerificationStatus } from '../dto';
import { verificationStatus } from '../formatters/admin-agent-list.formatter';

describe('verificationStatus', () => {
  const now = new Date('2026-11-12T10:00:00.000Z');
  const past = new Date('2026-11-01T00:00:00.000Z');
  const future = new Date('2026-12-01T00:00:00.000Z');
  const verified = {
    isVerified: true,
    rejectedAt: null,
    suspendedAt: null,
    suspendedUntil: null,
  };

  it('is SUSPENDED for an open-ended suspension', () => {
    expect(verificationStatus({ ...verified, suspendedAt: past }, now)).toBe(
      AgentVerificationStatus.SUSPENDED,
    );
  });

  it('is SUSPENDED until a future date', () => {
    expect(
      verificationStatus(
        { ...verified, suspendedAt: past, suspendedUntil: future },
        now,
      ),
    ).toBe(AgentVerificationStatus.SUSPENDED);
  });

  it('is VERIFIED once suspendedUntil has passed', () => {
    expect(
      verificationStatus(
        { ...verified, suspendedAt: past, suspendedUntil: past },
        now,
      ),
    ).toBe(AgentVerificationStatus.VERIFIED);
  });

  it('lets REJECTED win over a leftover suspension', () => {
    expect(
      verificationStatus(
        { ...verified, rejectedAt: past, suspendedAt: past },
        now,
      ),
    ).toBe(AgentVerificationStatus.REJECTED);
  });

  it('keeps ONBOARDING, VERIFIED and PENDING', () => {
    expect(verificationStatus(null, now)).toBe(
      AgentVerificationStatus.ONBOARDING,
    );
    expect(verificationStatus(verified, now)).toBe(
      AgentVerificationStatus.VERIFIED,
    );
    expect(verificationStatus({ ...verified, isVerified: false }, now)).toBe(
      AgentVerificationStatus.PENDING,
    );
  });
});
