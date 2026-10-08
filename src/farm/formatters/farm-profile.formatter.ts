import { ProduceStatus, type Prisma } from '../../../generated/client';
import type { FarmProfileDto } from '../dto';

export const FARM_PROFILE_SELECT = {
  id: true,
  farmCode: true,
  verificationStatus: true,
  country: true,
  mainProduce: true,
  state: { select: { id: true, name: true } },
  lga: { select: { id: true, stateId: true, name: true } },
  produce: {
    where: { status: { not: ProduceStatus.DRAFT } },
    select: { name: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.FarmSelect;

type FarmProfileRow = Prisma.FarmGetPayload<{
  select: typeof FARM_PROFILE_SELECT;
}>;

export function formatFarmProfile(farm: FarmProfileRow): FarmProfileDto {
  return {
    id: farm.id,
    farmCode: farm.farmCode,
    verificationStatus: farm.verificationStatus,
    country: farm.country,
    state: farm.state,
    lga: farm.lga,
    primaryProduce: uniqueNames([
      farm.mainProduce,
      ...farm.produce.map((listing) => listing.name),
    ]),
  };
}

// Listing names are free text, so "Cassava" and " cassava" are one crop; the
// first spelling seen wins.
function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, string>();
  for (const name of names) {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.set(key, trimmed);
    }
  }
  return [...seen.values()];
}
