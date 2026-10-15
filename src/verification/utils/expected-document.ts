/** The files a verification round collects, besides the farmer's ID and the farm's ownership document. */
export enum ExpectedDocument {
  LOCATION_EVIDENCE = 'LOCATION_EVIDENCE',
  PRODUCTION_EVIDENCE = 'PRODUCTION_EVIDENCE',
  FARM_PLOT_SKETCH = 'FARM_PLOT_SKETCH',
  HARVEST_ESTIMATE = 'HARVEST_ESTIMATE',
}

export interface RoundDocuments {
  locationEvidenceKey: string | null;
  productionEvidenceKey: string | null;
  farmPlotSketchKey: string | null;
  harvestEstimateKey: string | null;
}

/** Only the field being replaced is written; the others stay as they are. */
export function documentUpdate(
  document: ExpectedDocument,
  storageKey: string,
): Partial<RoundDocuments> {
  switch (document) {
    case ExpectedDocument.LOCATION_EVIDENCE:
      return { locationEvidenceKey: storageKey };
    case ExpectedDocument.PRODUCTION_EVIDENCE:
      return { productionEvidenceKey: storageKey };
    case ExpectedDocument.FARM_PLOT_SKETCH:
      return { farmPlotSketchKey: storageKey };
    case ExpectedDocument.HARVEST_ESTIMATE:
      return { harvestEstimateKey: storageKey };
  }
}

export function storedDocumentKey(
  round: RoundDocuments,
  document: ExpectedDocument,
): string | null {
  switch (document) {
    case ExpectedDocument.LOCATION_EVIDENCE:
      return round.locationEvidenceKey;
    case ExpectedDocument.PRODUCTION_EVIDENCE:
      return round.productionEvidenceKey;
    case ExpectedDocument.FARM_PLOT_SKETCH:
      return round.farmPlotSketchKey;
    case ExpectedDocument.HARVEST_ESTIMATE:
      return round.harvestEstimateKey;
  }
}

/** Send exactly one: a named document, or the check an issue photo belongs to. */
export function evidenceRequestError(request: {
  document?: ExpectedDocument | null;
  checkKey?: string | null;
}): string | null {
  const hasDocument = Boolean(request.document);
  const hasCheck = Boolean(request.checkKey);
  if (hasDocument === hasCheck) {
    return 'Send either a document or a checkKey';
  }
  return null;
}
