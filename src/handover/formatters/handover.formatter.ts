import { HandoverStatus, type Prisma } from '../../../generated/client';
import {
  FARM_SUMMARY_INCLUDE,
  formatFarmSummary,
} from '../../farm/formatters/farm.formatter';
import type { StorageService } from '../../storage/storage.service';
import type { HandoverDto } from '../dto';

/** Statuses that still need the agent: they show as tasks. */
export const OPEN_HANDOVER_STATUSES: HandoverStatus[] = [
  HandoverStatus.PENDING,
  HandoverStatus.VERIFIED,
];

export const HANDOVER_INCLUDE = {
  proofs: { orderBy: { createdAt: 'asc' as const } },
  order: {
    include: {
      produce: { select: { unit: true } },
      farm: { include: FARM_SUMMARY_INCLUDE },
    },
  },
} satisfies Prisma.OrderHandoverInclude;

type HandoverRow = Prisma.OrderHandoverGetPayload<{
  include: typeof HANDOVER_INCLUDE;
}>;

export async function formatHandover(
  storage: StorageService,
  handover: HandoverRow,
): Promise<HandoverDto> {
  const { order } = handover;
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: handover.status,
    produceName: order.produceName,
    quantity: order.quantity,
    unit: order.produce.unit,
    type: order.type,
    farm: formatFarmSummary(order.farm),
    verificationNote: handover.verificationNote,
    verifiedAt: handover.verifiedAt,
    recipientName: handover.recipientName,
    recipientPhone: handover.recipientPhone,
    handoverNote: handover.handoverNote,
    handedOverAt: handover.handedOverAt,
    proof: await Promise.all(
      handover.proofs.map(async (item) => ({
        id: item.id,
        url: await storage.getPresignedUrl(item.storageKey),
        createdAt: item.createdAt,
      })),
    ),
    createdAt: handover.createdAt,
  };
}
