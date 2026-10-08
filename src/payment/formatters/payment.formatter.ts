import type { Payment, Prisma } from '../../../generated/client';
import type { PaymentDto } from '../dto';
import type { BankTransferInstructions } from '../providers/payment-provider';

export function formatPayment(payment: Payment): PaymentDto {
  const data = asObject(payment.providerData);
  const url = data?.authorizationUrl;
  return {
    id: payment.id,
    reference: payment.reference,
    method: payment.method,
    status: payment.status,
    amount: payment.amount.toFixed(2),
    authorizationUrl: typeof url === 'string' ? url : null,
    bankTransfer: bankTransferOf(data?.bankTransfer),
    paidAt: payment.paidAt,
    createdAt: payment.createdAt,
  };
}

// providerData is untyped JSON; anything not shaped as we stored it reads as absent.
function bankTransferOf(
  value: Prisma.JsonValue | undefined,
): BankTransferInstructions | null {
  const transfer = asObject(value);
  if (!transfer) {
    return null;
  }
  const { bankName, accountName, accountNumber, amount, narration } = transfer;
  if (
    typeof bankName !== 'string' ||
    typeof accountName !== 'string' ||
    typeof accountNumber !== 'string' ||
    typeof amount !== 'string' ||
    typeof narration !== 'string'
  ) {
    return null;
  }
  return { bankName, accountName, accountNumber, amount, narration };
}

function asObject(
  value: Prisma.JsonValue | undefined,
): Prisma.JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : null;
}
