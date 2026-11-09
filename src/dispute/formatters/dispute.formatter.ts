import type { Prisma } from '../../../generated/client';
import { formatRefund } from '../../payment/formatters/refund.formatter';
import type { StorageService } from '../../storage/storage.service';
import type { DisputeDto } from '../dto';

export const DISPUTE_INCLUDE = {
  photos: { orderBy: { createdAt: 'asc' as const } },
  refunds: { orderBy: { createdAt: 'asc' as const } },
  order: { select: { orderNumber: true, checkoutId: true } },
} satisfies Prisma.DisputeInclude;

export type DisputeRow = Prisma.DisputeGetPayload<{
  include: typeof DISPUTE_INCLUDE;
}>;

export async function formatDispute(
  storage: StorageService,
  dispute: DisputeRow,
): Promise<DisputeDto> {
  return {
    id: dispute.id,
    orderId: dispute.orderId,
    orderNumber: dispute.order.orderNumber,
    status: dispute.status,
    reason: dispute.reason,
    quantityAffected: dispute.quantityAffected,
    refundPercent: dispute.refundPercent?.toFixed(2) ?? null,
    resolutionNote: dispute.resolutionNote,
    resolvedAt: dispute.resolvedAt,
    photos: await Promise.all(
      dispute.photos.map(async (photo) => ({
        id: photo.id,
        url: await storage.getPresignedUrl(photo.key),
        createdAt: photo.createdAt,
      })),
    ),
    refunds: dispute.refunds.map(formatRefund),
    createdAt: dispute.createdAt,
  };
}
