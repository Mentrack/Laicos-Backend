import type { Payment, Prisma } from '../../../generated/client';
import type { PaymentDto } from '../dto';

export function formatPayment(payment: Payment): PaymentDto {
  const data = asObject(payment.providerData);
  return {
    id: payment.id,
    reference: payment.reference,
    status: payment.status,
    currency: payment.currency,
    amount: payment.amount.toFixed(2),
    chargedAmount: payment.chargedAmount.toFixed(2),
    fxRate: payment.fxRate?.toFixed(6) ?? null,
    channel: payment.channel,
    authorizationUrl: stringOrNull(data?.authorizationUrl),
    accessCode: stringOrNull(data?.accessCode),
    failureReason: payment.failureReason,
    paidAt: payment.paidAt,
    createdAt: payment.createdAt,
  };
}

// providerData is untyped JSON; anything not shaped as we stored it reads as absent.
function stringOrNull(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function asObject(
  value: Prisma.JsonValue | undefined,
): Prisma.JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : null;
}
