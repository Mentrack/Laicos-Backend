import { ProduceStatus } from '../../../generated/client';

/**
 * Keeps `status` in sync with stock: PUBLISHED flips to SOLD_OUT once
 * nothing is left to order, and back once stock returns. DRAFT (and any
 * other status) is left alone — sold-out only means something for a
 * published listing.
 */
export function deriveProduceStatus(
  status: ProduceStatus,
  {
    actualQuantity,
    floatingQuantity,
  }: { actualQuantity: number; floatingQuantity: number },
): ProduceStatus {
  if (status !== ProduceStatus.PUBLISHED && status !== ProduceStatus.SOLD_OUT) {
    return status;
  }
  return actualQuantity <= 0 || floatingQuantity <= 0
    ? ProduceStatus.SOLD_OUT
    : ProduceStatus.PUBLISHED;
}
