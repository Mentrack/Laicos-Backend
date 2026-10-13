import type { Refund } from '../../../generated/client';
import type { RefundDto } from '../dto';

export function formatRefund(refund: Refund): RefundDto {
  return {
    id: refund.id,
    orderId: refund.orderId,
    amount: refund.amount.toFixed(2),
    status: refund.status,
    reason: refund.reason,
    failureReason: refund.failureReason,
    createdAt: refund.createdAt,
  };
}
