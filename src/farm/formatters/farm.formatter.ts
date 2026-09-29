import { FarmVerificationStatus, type Prisma } from '../../../generated/client';
import type { StorageService } from '../../storage/storage.service';
import type { FarmDto, FarmSummaryDto } from '../dto';

export const FARM_INCLUDE = {
  state: true,
  lga: true,
  // The latest round only, for its rejection reason.
  verifications: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { rejectionReason: true },
  },
} satisfies Prisma.FarmInclude;

type FarmRow = Prisma.FarmGetPayload<{ include: typeof FARM_INCLUDE }>;

/** Storage keys never leave the server; documents go out as presigned URLs. */
export async function formatFarm(
  storage: StorageService,
  farm: FarmRow,
): Promise<FarmDto> {
  const [ownershipDocumentUrl, chiefConfirmationUrl] = await Promise.all([
    storage.getPresignedUrl(farm.ownershipDocumentKey),
    storage.presignedUrlOrNull(farm.chiefConfirmationKey),
  ]);
  return {
    id: farm.id,
    farmCode: farm.farmCode,
    ownerId: farm.ownerId,
    name: farm.name,
    country: farm.country,
    state: { id: farm.state.id, name: farm.state.name },
    lga: { id: farm.lga.id, stateId: farm.lga.stateId, name: farm.lga.name },
    location: farm.location,
    size: farm.size,
    unit: farm.unit,
    mainProduce: farm.mainProduce,
    isExporting: farm.isExporting,
    referralAgentId: farm.referralAgentId,
    verificationStatus: farm.verificationStatus,
    rejectionReason:
      farm.verificationStatus === FarmVerificationStatus.REJECTED
        ? (farm.verifications[0]?.rejectionReason ?? null)
        : null,
    isClustered: farm.isClustered,
    clusterId: farm.clusterId,
    ownershipDocumentUrl,
    chiefConfirmationUrl,
    createdAt: farm.createdAt,
    updatedAt: farm.updatedAt,
  };
}

export const FARM_SUMMARY_INCLUDE = {
  state: true,
  lga: true,
} satisfies Prisma.FarmInclude;

type FarmSummaryRow = Prisma.FarmGetPayload<{
  include: typeof FARM_SUMMARY_INCLUDE;
}>;

export function formatFarmSummary(farm: FarmSummaryRow): FarmSummaryDto {
  return {
    id: farm.id,
    farmCode: farm.farmCode,
    name: farm.name,
    location: farm.location,
    state: { id: farm.state.id, name: farm.state.name },
    lga: { id: farm.lga.id, stateId: farm.lga.stateId, name: farm.lga.name },
    size: farm.size,
    unit: farm.unit,
    mainProduce: farm.mainProduce,
  };
}
