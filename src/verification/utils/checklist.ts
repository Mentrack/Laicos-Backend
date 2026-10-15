import {
  CheckResult,
  EvidenceKind,
  PhotoSlot,
  VerificationCheckKey,
  type Prisma,
} from '../../../generated/client';
import type { RoundDocuments } from './expected-document';

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

export function isResultAllowed(
  key: VerificationCheckKey,
  result: CheckResult,
): boolean {
  return CHECK_RESULTS[key].includes(result);
}

export interface ChecklistState extends RoundDocuments {
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
  // Agent-onboarded farms start without these; the farmer uploads them later.
  farm: {
    ownershipDocumentKey: string | null;
    owner: { idDocumentKey: string | null };
  };
}

export const CHECKLIST_DOCUMENTS_SELECT = {
  ownershipDocumentKey: true,
  owner: { select: { idDocumentKey: true } },
} satisfies Prisma.FarmSelect;

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
  if (!round.farm.owner.idDocumentKey) {
    gaps.push('Farmer ID document is required');
  }
  if (!round.farm.ownershipDocumentKey) {
    gaps.push('Ownership document is required');
  }
  if (!round.identityNote) {
    gaps.push('Identity note is required');
  }

  if (!round.locationEvidenceKey) {
    gaps.push('Location evidence is required');
  }
  if (!round.productionEvidenceKey) {
    gaps.push('Production evidence is required');
  }
  if (!round.farmPlotSketchKey) {
    gaps.push('Farm plot sketch is required');
  }
  if (!round.harvestEstimateKey) {
    gaps.push('Harvest estimate is required');
  }
  if (!round.generalNote) {
    gaps.push('General note is required');
  }
  return gaps;
}
