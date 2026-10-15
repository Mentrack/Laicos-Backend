import {
  CheckResult,
  EvidenceKind,
  Prisma,
  VerificationCheckKey,
} from '../../../generated/client';
import {
  checklistGaps,
  isResultAllowed,
  type ChecklistState,
} from '../utils/checklist';
import {
  evidenceRequestError,
  ExpectedDocument,
} from '../utils/expected-document';

function complete(): ChecklistState {
  return {
    locationMatches: true,
    discrepancyLat: null,
    discrepancyLng: null,
    discrepancyNote: null,
    identityNote: 'ID matches the farmer',
    generalNote: 'Healthy maize, good access',
    checks: Object.values(VerificationCheckKey).map((key) => ({
      key,
      result: CheckResult.VERIFIED,
      note: null,
    })),
    locationEvidenceKey: 'location',
    productionEvidenceKey: 'production',
    farmPlotSketchKey: 'plot',
    harvestEstimateKey: 'harvest',
    evidence: [],
    farm: { ownershipDocumentKey: 'own', owner: { idDocumentKey: 'id' } },
  };
}

describe('isResultAllowed', () => {
  it('lets identity checks be UNABLE but not NOT_APPLICABLE', () => {
    const key = VerificationCheckKey.FARMER_ID;
    expect(isResultAllowed(key, CheckResult.UNABLE)).toBe(true);
    expect(isResultAllowed(key, CheckResult.NOT_APPLICABLE)).toBe(false);
  });

  it('lets field checks be NOT_APPLICABLE but not UNABLE', () => {
    const key = VerificationCheckKey.CROP_HEALTH;
    expect(isResultAllowed(key, CheckResult.NOT_APPLICABLE)).toBe(true);
    expect(isResultAllowed(key, CheckResult.UNABLE)).toBe(false);
  });
});

describe('evidenceRequestError', () => {
  it.each([
    [{ document: ExpectedDocument.LOCATION_EVIDENCE }],
    [{ checkKey: VerificationCheckKey.FARM_ACTIVE }],
  ])('accepts %j', (request) => {
    expect(evidenceRequestError(request)).toBeNull();
  });

  it.each([
    [{}],
    [
      {
        document: ExpectedDocument.PRODUCTION_EVIDENCE,
        checkKey: VerificationCheckKey.FARM_ACTIVE,
      },
    ],
  ])('rejects %j', (request) => {
    expect(evidenceRequestError(request)).not.toBeNull();
  });
});

describe('checklistGaps', () => {
  it('is empty for a complete checklist', () => {
    expect(checklistGaps(complete())).toEqual([]);
  });

  it('requires the farmer’s ID and the ownership document', () => {
    expect(
      checklistGaps({
        ...complete(),
        farm: { ownershipDocumentKey: null, owner: { idDocumentKey: null } },
      }),
    ).toEqual([
      'Farmer ID document is required',
      'Ownership document is required',
    ]);
  });

  it('lists everything missing from an untouched round', () => {
    const gaps = checklistGaps({
      ...complete(),
      locationMatches: null,
      identityNote: null,
      generalNote: null,
      checks: [],
      locationEvidenceKey: null,
      productionEvidenceKey: null,
      farmPlotSketchKey: null,
      harvestEstimateKey: null,
      evidence: [],
    });
    expect(gaps).toEqual([
      'Location match is not recorded',
      ...Object.values(VerificationCheckKey).map(
        (key) => `${key} is not recorded`,
      ),
      'Identity note is required',
      'Location evidence is required',
      'Production evidence is required',
      'Farm plot sketch is required',
      'Harvest estimate is required',
      'General note is required',
    ]);
  });

  it('requires coordinates and a note for a location discrepancy', () => {
    expect(checklistGaps({ ...complete(), locationMatches: false })).toEqual([
      'Location discrepancy needs coordinates and a note',
    ]);
    expect(
      checklistGaps({
        ...complete(),
        locationMatches: false,
        discrepancyLat: new Prisma.Decimal('8.1'),
        discrepancyLng: new Prisma.Decimal('4.2'),
        discrepancyNote: 'East of the address',
      }),
    ).toEqual([]);
  });

  it('requires a note and that check’s own evidence for an issue', () => {
    const state = complete();
    state.checks[0] = {
      key: VerificationCheckKey.FARMER_ID,
      result: CheckResult.ISSUE,
      note: null,
    };
    // Evidence for a different check doesn't count.
    state.evidence.push({
      kind: EvidenceKind.CHECK,
      checkKey: VerificationCheckKey.FARM_ACTIVE,
      photoSlot: null,
    });
    expect(checklistGaps(state)).toEqual([
      'FARMER_ID issue needs a note',
      'FARMER_ID issue needs evidence',
    ]);
  });
});
