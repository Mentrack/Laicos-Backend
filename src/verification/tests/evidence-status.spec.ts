import { EvidenceStatus } from '../../../generated/client';
import {
  documentsComplete,
  nextEvidenceStatus,
} from '../utils/evidence-status';

const present = {
  idDocumentKey: 'id',
  ownershipDocumentKey: 'own',
  locationEvidenceKey: 'location',
  productionEvidenceKey: 'production',
  farmPlotSketchKey: 'plot',
  harvestEstimateKey: 'harvest',
};

describe('documentsComplete', () => {
  it('is true only when every expected document is stored', () => {
    expect(documentsComplete(present)).toBe(true);
    expect(documentsComplete({ ...present, harvestEstimateKey: null })).toBe(
      false,
    );
  });
});

describe('nextEvidenceStatus', () => {
  it('follows the documents when the status was not chosen', () => {
    expect(nextEvidenceStatus(EvidenceStatus.MISSING_DOCS, false)).toBe(
      EvidenceStatus.MISSING_DOCS,
    );
    expect(nextEvidenceStatus(EvidenceStatus.MISSING_DOCS, true)).toBe(
      EvidenceStatus.INCOMPLETE,
    );
    expect(nextEvidenceStatus(EvidenceStatus.INCOMPLETE, false)).toBe(
      EvidenceStatus.MISSING_DOCS,
    );
  });

  it('keeps a status an agent set', () => {
    expect(nextEvidenceStatus(EvidenceStatus.AWAITING_DOCS, true)).toBe(
      EvidenceStatus.AWAITING_DOCS,
    );
    expect(nextEvidenceStatus(EvidenceStatus.FOLLOW_UP, false)).toBe(
      EvidenceStatus.FOLLOW_UP,
    );
  });
});
