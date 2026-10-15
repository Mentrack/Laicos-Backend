import {
  EvidenceStatus,
  Prisma,
  VerificationTaskStatus,
} from '../../../generated/client';

// Unassigned rounds can already be waiting on documents.
const TRACKED: VerificationTaskStatus[] = [
  VerificationTaskStatus.UNASSIGNED,
  VerificationTaskStatus.ASSIGNED,
  VerificationTaskStatus.IN_PROGRESS,
];

export interface ExpectedDocuments {
  idDocumentKey: string | null;
  ownershipDocumentKey: string | null;
  locationEvidenceKey: string | null;
  productionEvidenceKey: string | null;
  farmPlotSketchKey: string | null;
  harvestEstimateKey: string | null;
}

export function documentsComplete(documents: ExpectedDocuments): boolean {
  return Boolean(
    documents.idDocumentKey &&
    documents.ownershipDocumentKey &&
    documents.locationEvidenceKey &&
    documents.productionEvidenceKey &&
    documents.farmPlotSketchKey &&
    documents.harvestEstimateKey,
  );
}

/**
 * Awaiting docs and follow-up are choices an agent made, so a later upload
 * does not clear them. The other two follow whether every expected document
 * is stored.
 */
export function nextEvidenceStatus(
  current: EvidenceStatus,
  complete: boolean,
): EvidenceStatus {
  if (
    current === EvidenceStatus.AWAITING_DOCS ||
    current === EvidenceStatus.FOLLOW_UP
  ) {
    return current;
  }
  return complete ? EvidenceStatus.INCOMPLETE : EvidenceStatus.MISSING_DOCS;
}

type EvidenceDb = Pick<Prisma.TransactionClient, 'farm' | 'farmVerification'>;

export async function refreshFarmEvidenceStatus(
  db: EvidenceDb,
  farmId: string,
): Promise<void> {
  const farm = await db.farm.findUnique({
    where: { id: farmId },
    select: {
      ownershipDocumentKey: true,
      owner: { select: { idDocumentKey: true } },
      verifications: {
        where: { status: { in: TRACKED } },
        select: {
          id: true,
          evidenceStatus: true,
          locationEvidenceKey: true,
          productionEvidenceKey: true,
          farmPlotSketchKey: true,
          harvestEstimateKey: true,
        },
      },
    },
  });
  if (!farm) {
    return;
  }
  for (const round of farm.verifications) {
    const next = nextEvidenceStatus(
      round.evidenceStatus,
      documentsComplete({
        idDocumentKey: farm.owner.idDocumentKey,
        ownershipDocumentKey: farm.ownershipDocumentKey,
        locationEvidenceKey: round.locationEvidenceKey,
        productionEvidenceKey: round.productionEvidenceKey,
        farmPlotSketchKey: round.farmPlotSketchKey,
        harvestEstimateKey: round.harvestEstimateKey,
      }),
    );
    if (next === round.evidenceStatus) {
      continue;
    }
    await db.farmVerification.update({
      where: { id: round.id },
      data: { evidenceStatus: next },
    });
  }
}

export async function refreshFarmerEvidenceStatus(
  db: EvidenceDb,
  farmerId: string,
): Promise<void> {
  const farms = await db.farm.findMany({
    where: { ownerId: farmerId },
    select: { id: true },
  });
  for (const farm of farms) {
    await refreshFarmEvidenceStatus(db, farm.id);
  }
}
