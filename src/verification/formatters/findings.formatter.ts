import type {
  FarmVerification,
  Prisma,
  VerificationCheck,
} from '../../../generated/client';
import type { VerificationFindingsDto } from '../dto';

export const VERIFICATION_CHECKS_INCLUDE = {
  checks: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.FarmVerificationInclude;

type FindingsRow = Pick<
  FarmVerification,
  | 'locationMatches'
  | 'discrepancyLat'
  | 'discrepancyLng'
  | 'discrepancyNote'
  | 'identityNote'
  | 'measuredSize'
  | 'estimatedYield'
  | 'estimatedYieldUnit'
  | 'generalNote'
  | 'rejectionReason'
> & { checks: Pick<VerificationCheck, 'key' | 'result' | 'note'>[] };

export function formatVerificationFindings(
  round: FindingsRow,
): VerificationFindingsDto {
  return {
    locationMatches: round.locationMatches,
    discrepancyLat: round.discrepancyLat?.toNumber() ?? null,
    discrepancyLng: round.discrepancyLng?.toNumber() ?? null,
    discrepancyNote: round.discrepancyNote,
    identityNote: round.identityNote,
    measuredSize: round.measuredSize,
    estimatedYield: round.estimatedYield,
    estimatedYieldUnit: round.estimatedYieldUnit,
    generalNote: round.generalNote,
    rejectionReason: round.rejectionReason,
    checks: round.checks.map(({ key, result, note }) => ({
      key,
      result,
      note,
    })),
  };
}
