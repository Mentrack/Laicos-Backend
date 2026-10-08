import type { Farmer } from '../../../generated/client';
import type { FarmerDto } from '../dto';

// Picks fields rather than returning the row: the row carries the farmer's
// ID number and document key, which other users must never see.
export function toFarmerDto(farmer: Farmer): FarmerDto {
  return {
    id: farmer.id,
    farmerId: farmer.farmerId,
    userId: farmer.userId,
    createdAt: farmer.createdAt,
    updatedAt: farmer.updatedAt,
  };
}
