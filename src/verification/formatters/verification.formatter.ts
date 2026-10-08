import type { Prisma } from '../../../generated/client';
import { formatIdentity } from '../../common/identity';
import type { StorageService } from '../../storage/storage.service';
import {
  FARM_SUMMARY_INCLUDE,
  formatFarmSummary,
} from '../../farm/formatters/farm.formatter';
import type { VerificationDto, VerificationSummaryDto } from '../dto';
import { checklistGaps } from '../utils/checklist';

export const VERIFICATION_SUMMARY_INCLUDE = {
  farm: { include: FARM_SUMMARY_INCLUDE },
} satisfies Prisma.FarmVerificationInclude;

export const VERIFICATION_DETAIL_INCLUDE = {
  farm: {
    include: {
      state: true,
      lga: true,
      owner: {
        include: {
          user: {
            select: { firstName: true, lastName: true, phoneNumber: true },
          },
        },
      },
    },
  },
  checks: { orderBy: { createdAt: 'asc' } },
  evidence: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.FarmVerificationInclude;

type SummaryRow = Prisma.FarmVerificationGetPayload<{
  include: typeof VERIFICATION_SUMMARY_INCLUDE;
}>;
type DetailRow = Prisma.FarmVerificationGetPayload<{
  include: typeof VERIFICATION_DETAIL_INCLUDE;
}>;

export function formatVerificationSummary(
  round: SummaryRow,
): VerificationSummaryDto {
  return {
    id: round.id,
    status: round.status,
    farm: formatFarmSummary(round.farm),
    startedAt: round.startedAt,
    decidedAt: round.decidedAt,
    createdAt: round.createdAt,
  };
}

export async function formatVerification(
  storage: StorageService,
  round: DetailRow,
): Promise<VerificationDto> {
  const { farm } = round;
  const { owner } = farm;
  const [ownershipDocumentUrl, chiefConfirmationUrl, identity, evidence] =
    await Promise.all([
      storage.presignedUrlOrNull(farm.ownershipDocumentKey),
      storage.presignedUrlOrNull(farm.chiefConfirmationKey),
      formatIdentity(storage, owner),
      Promise.all(
        round.evidence.map(async (item) => ({
          id: item.id,
          kind: item.kind,
          checkKey: item.checkKey,
          photoSlot: item.photoSlot,
          url: await storage.getPresignedUrl(item.storageKey),
          createdAt: item.createdAt,
        })),
      ),
    ]);

  return {
    ...formatVerificationSummary(round),
    farm: {
      ...formatFarmSummary(farm),
      isExporting: farm.isExporting,
      ownershipDocumentUrl,
      chiefConfirmationUrl,
      farmer: {
        id: owner.id,
        farmerId: owner.farmerId,
        firstName: owner.user.firstName,
        lastName: owner.user.lastName,
        phoneNumber: owner.user.phoneNumber,
        ...identity,
      },
    },
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
    evidence,
    outstanding: checklistGaps(round),
  };
}
