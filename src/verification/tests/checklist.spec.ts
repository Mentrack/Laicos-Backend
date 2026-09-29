import {
  CheckResult,
  EvidenceKind,
  PhotoSlot,
  Prisma,
  VerificationCheckKey,
} from '../../../generated/client';
import {
  checklistGaps,
  evidenceShapeError,
  isResultAllowed,
  type ChecklistState,
} from '../utils/checklist';

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
    evidence: [PhotoSlot.ENTRANCE, PhotoSlot.FARM_AREA, PhotoSlot.PRODUCE].map(
      (photoSlot) => ({ kind: EvidenceKind.PHOTO, checkKey: null, photoSlot }),
    ),
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

describe('evidenceShapeError', () => {
  it.each([
    [{ kind: EvidenceKind.CHECK, checkKey: VerificationCheckKey.FARM_ACTIVE }],
    [{ kind: EvidenceKind.PHOTO, photoSlot: PhotoSlot.ENTRANCE }],
    [{ kind: EvidenceKind.LOCATION_DISCREPANCY }],
  ])('accepts %j', (evidence) => {
    expect(evidenceShapeError(evidence)).toBeNull();
  });

  it.each([
    [{ kind: EvidenceKind.CHECK }],
    [{ kind: EvidenceKind.PHOTO }],
    [
      {
        kind: EvidenceKind.LOCATION_DISCREPANCY,
        photoSlot: PhotoSlot.ENTRANCE,
      },
    ],
    [
      {
        kind: EvidenceKind.PHOTO,
        photoSlot: PhotoSlot.ENTRANCE,
        checkKey: VerificationCheckKey.FARM_ACTIVE,
      },
    ],
  ])('rejects %j', (evidence) => {
    expect(evidenceShapeError(evidence)).not.toBeNull();
  });
});

describe('checklistGaps', () => {
  it('is empty for a complete checklist', () => {
    expect(checklistGaps(complete())).toEqual([]);
  });

  it('lists everything missing from an untouched round', () => {
    const gaps = checklistGaps({
      ...complete(),
      locationMatches: null,
      identityNote: null,
      generalNote: null,
      checks: [],
      evidence: [],
    });
    expect(gaps).toEqual([
      'Location match is not recorded',
      ...Object.values(VerificationCheckKey).map(
        (key) => `${key} is not recorded`,
      ),
      'Identity note is required',
      'ENTRANCE photo is required',
      'FARM_AREA photo is required',
      'PRODUCE photo is required',
      'General note is required',
    ]);
  });

  it('requires coordinates, a note and evidence for a location discrepancy', () => {
    expect(checklistGaps({ ...complete(), locationMatches: false })).toEqual([
      'Location discrepancy needs coordinates and a note',
      'Location discrepancy needs evidence',
    ]);
    const state = complete();
    expect(
      checklistGaps({
        ...state,
        locationMatches: false,
        discrepancyLat: new Prisma.Decimal('8.1'),
        discrepancyLng: new Prisma.Decimal('4.2'),
        discrepancyNote: 'East of the address',
        evidence: [
          ...state.evidence,
          {
            kind: EvidenceKind.LOCATION_DISCREPANCY,
            checkKey: null,
            photoSlot: null,
          },
        ],
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

  it('treats the infrastructure photo as optional', () => {
    const state = complete();
    expect(
      state.evidence.some(
        (item) => item.photoSlot === PhotoSlot.INFRASTRUCTURE,
      ),
    ).toBe(false);
    expect(checklistGaps(state)).toEqual([]);
  });
});
