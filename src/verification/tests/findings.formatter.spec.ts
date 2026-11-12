import {
  CheckResult,
  Prisma,
  VerificationCheckKey,
} from '../../../generated/client';
import { formatVerificationFindings } from '../formatters/findings.formatter';

describe('formatVerificationFindings', () => {
  it('maps every agent finding and converts the discrepancy coordinates', () => {
    expect(
      formatVerificationFindings({
        locationMatches: false,
        discrepancyLat: new Prisma.Decimal('8.123456'),
        discrepancyLng: new Prisma.Decimal('4.5'),
        discrepancyNote: 'Gate is 200 m north',
        identityNote: 'ID matches',
        measuredSize: 4.2,
        estimatedYield: 12,
        estimatedYieldUnit: 'tonnes',
        generalNote: 'All good',
        rejectionReason: null,
        checks: [
          {
            key: VerificationCheckKey.FARMER_ID,
            result: CheckResult.VERIFIED,
            note: null,
          },
        ],
      }),
    ).toEqual({
      locationMatches: false,
      discrepancyLat: 8.123456,
      discrepancyLng: 4.5,
      discrepancyNote: 'Gate is 200 m north',
      identityNote: 'ID matches',
      measuredSize: 4.2,
      estimatedYield: 12,
      estimatedYieldUnit: 'tonnes',
      generalNote: 'All good',
      rejectionReason: null,
      checks: [{ key: 'FARMER_ID', result: 'VERIFIED', note: null }],
    });
  });

  it('returns nulls and an empty checks list for a round the agent has not started', () => {
    const findings = formatVerificationFindings({
      locationMatches: null,
      discrepancyLat: null,
      discrepancyLng: null,
      discrepancyNote: null,
      identityNote: null,
      measuredSize: null,
      estimatedYield: null,
      estimatedYieldUnit: null,
      generalNote: null,
      rejectionReason: null,
      checks: [],
    });
    expect(findings.discrepancyLat).toBeNull();
    expect(findings.discrepancyLng).toBeNull();
    expect(findings.checks).toEqual([]);
  });
});
