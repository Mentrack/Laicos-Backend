import {
  CheckResult,
  EvidenceKind,
  PhotoSlot,
  VerificationCheckKey,
  type Prisma,
} from '../../../generated/client';

// Identity documents can be impossible to see on the day (UNABLE); farm
// parameters and production can simply not apply (NOT_APPLICABLE).
const IDENTITY_RESULTS = [
  CheckResult.VERIFIED,
  CheckResult.ISSUE,
  CheckResult.UNABLE,
] as const;
const FIELD_RESULTS = [
  CheckResult.VERIFIED,
  CheckResult.ISSUE,
  CheckResult.NOT_APPLICABLE,
] as const;

/** Every check and the results its section allows. */
export const CHECK_RESULTS: Record<
  VerificationCheckKey,
  readonly CheckResult[]
> = {
  [VerificationCheckKey.FARMER_ID]: IDENTITY_RESULTS,
  [VerificationCheckKey.FARM_OWNERSHIP]: IDENTITY_RESULTS,
  [VerificationCheckKey.CHIEF_CONFIRMATION]: IDENTITY_RESULTS,
  [VerificationCheckKey.FARM_ACTIVE]: FIELD_RESULTS,
  [VerificationCheckKey.ACCESS_ROUTE]: FIELD_RESULTS,
  [VerificationCheckKey.MEASUREMENTS]: FIELD_RESULTS,
  [VerificationCheckKey.DECLARED_PRODUCE]: FIELD_RESULTS,
  [VerificationCheckKey.CROP_HEALTH]: FIELD_RESULTS,
  [VerificationCheckKey.ESTIMATED_YIELD]: FIELD_RESULTS,
};

export const REQUIRED_PHOTOS: readonly PhotoSlot[] = [
  PhotoSlot.ENTRANCE,
  PhotoSlot.FARM_AREA,
  PhotoSlot.PRODUCE,
];

export function isResultAllowed(
  key: VerificationCheckKey,
  result: CheckResult,
): boolean {
  return CHECK_RESULTS[key].includes(result);
}

/** A kind's evidence names exactly what that kind needs, and nothing else. */
export function evidenceShapeError(evidence: {
  kind: EvidenceKind;
  checkKey?: VerificationCheckKey | null;
  photoSlot?: PhotoSlot | null;
}): string | null {
  const hasCheck = Boolean(evidence.checkKey);
  const hasSlot = Boolean(evidence.photoSlot);
  if ((evidence.kind === EvidenceKind.CHECK) !== hasCheck) {
    return 'checkKey is required for CHECK evidence and only allowed there';
  }
  if ((evidence.kind === EvidenceKind.PHOTO) !== hasSlot) {
    return 'photoSlot is required for PHOTO evidence and only allowed there';
  }
  return null;
}

export interface ChecklistState {
  locationMatches: boolean | null;
  discrepancyLat: Prisma.Decimal | null;
  discrepancyLng: Prisma.Decimal | null;
  discrepancyNote: string | null;
  identityNote: string | null;
  generalNote: string | null;
  checks: {
    key: VerificationCheckKey;
    result: CheckResult;
    note: string | null;
  }[];
  evidence: {
    kind: EvidenceKind;
    checkKey: VerificationCheckKey | null;
    photoSlot: PhotoSlot | null;
  }[];
}

/**
 * What still stops the agent approving, in checklist order. Empty means the
 * checklist is complete. Rejecting needs none of this.
 */
export function checklistGaps(round: ChecklistState): string[] {
  const gaps: string[] = [];
  const hasEvidence = (
    kind: EvidenceKind,
    match: (item: ChecklistState['evidence'][number]) => boolean = () => true,
  ) => round.evidence.some((item) => item.kind === kind && match(item));

  if (round.locationMatches === null) {
    gaps.push('Location match is not recorded');
  } else if (!round.locationMatches) {
    if (
      round.discrepancyLat === null ||
      round.discrepancyLng === null ||
      !round.discrepancyNote
    ) {
      gaps.push('Location discrepancy needs coordinates and a note');
    }
    if (!hasEvidence(EvidenceKind.LOCATION_DISCREPANCY)) {
      gaps.push('Location discrepancy needs evidence');
    }
  }

  const checks = new Map(round.checks.map((check) => [check.key, check]));
  for (const key of Object.values(VerificationCheckKey)) {
    const check = checks.get(key);
    if (!check) {
      gaps.push(`${key} is not recorded`);
      continue;
    }
    if (check.result !== CheckResult.ISSUE) {
      continue;
    }
    if (!check.note) {
      gaps.push(`${key} issue needs a note`);
    }
    if (!hasEvidence(EvidenceKind.CHECK, (item) => item.checkKey === key)) {
      gaps.push(`${key} issue needs evidence`);
    }
  }
  if (!round.identityNote) {
    gaps.push('Identity note is required');
  }

  for (const slot of REQUIRED_PHOTOS) {
    if (!hasEvidence(EvidenceKind.PHOTO, (item) => item.photoSlot === slot)) {
      gaps.push(`${slot} photo is required`);
    }
  }
  if (!round.generalNote) {
    gaps.push('General note is required');
  }
  return gaps;
}
