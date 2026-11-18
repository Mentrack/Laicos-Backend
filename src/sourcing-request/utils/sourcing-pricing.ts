import { ConflictException } from '@nestjs/common';
import { Prisma, SourcingUnit } from '../../../generated/client';
import { percentOf } from '../../common/money';
import { CheckoutConfig } from '../../payment/checkout-config';
import { commissionFor } from '../../payment/utils/order-share';
import { requestedAmount, unitsComparable } from './sourcing-rules';

export type PricedLine = {
  quantity: number;
  agreedUnitPrice: Prisma.Decimal;
};

export type SupplyLine = { quantity: number; unit: SourcingUnit };

// Weight sums in kilograms, so mixed kg and tonne offers add up exactly.
function inBaseUnit(line: SupplyLine): number {
  return line.unit === SourcingUnit.TONNES
    ? line.quantity * 1000
    : line.quantity;
}

function suppliedBase(requestUnit: SourcingUnit, lines: SupplyLine[]): number {
  return lines
    .filter((line) => unitsComparable(requestUnit, line.unit))
    .reduce((sum, line) => sum + inBaseUnit(line), 0);
}

function fromBaseUnit(requestUnit: SourcingUnit, base: number): number {
  return requestUnit === SourcingUnit.TONNES ? base / 1000 : base;
}

// In the request's unit, lines in other units counting as none. Worked out
// in the same base as isCovered, so the figures agree with it and a
// subtraction never shows float dust such as 0.19999999999999998.
export function supplyCoverage(
  request: { quantity: number; unit: SourcingUnit },
  lines: SupplyLine[],
) {
  const requested = requestedAmount(request.quantity, request.unit);
  const supplied = suppliedBase(request.unit, lines);
  return {
    requested: fromBaseUnit(request.unit, requested),
    selected: fromBaseUnit(request.unit, supplied),
    remaining: fromBaseUnit(request.unit, Math.max(0, requested - supplied)),
  };
}

export function isCovered(
  request: { quantity: number; unit: SourcingUnit },
  lines: SupplyLine[],
): boolean {
  return (
    suppliedBase(request.unit, lines) >=
    requestedAmount(request.quantity, request.unit)
  );
}

export function assertCovered(
  request: { quantity: number; unit: SourcingUnit },
  lines: SupplyLine[],
): void {
  if (!isCovered(request, lines)) {
    throw new ConflictException({
      message: 'Accepted offers do not cover the request yet',
      code: 'SOURCING_NOT_COVERED',
    });
  }
}

export function quote(lines: PricedLine[], config: CheckoutConfig) {
  const totals = lines.map((line) => line.agreedUnitPrice.mul(line.quantity));
  const subtotal = totals.reduce(
    (sum, total) => sum.add(total),
    new Prisma.Decimal(0),
  );
  const commissions = totals.map((total) =>
    commissionFor(total, config.agentCommissionPercent),
  );
  const serviceFee = percentOf(subtotal, config.serviceFeePercent);
  const agentCommission = commissions.reduce(
    (sum, commission) => sum.add(commission),
    new Prisma.Decimal(0),
  );
  return {
    subtotal,
    serviceFee,
    commissions,
    agentCommission,
    suggestedPrice: subtotal.add(serviceFee).add(agentCommission),
  };
}

export function assertAgreedPrice(
  agreed: Prisma.Decimal,
  suggested: Prisma.Decimal,
): void {
  // Rule B (spec): floor at the suggested price. Revisitable.
  if (agreed.lt(suggested)) {
    throw new ConflictException({
      message: 'The agreed price is below the suggested price',
      code: 'SOURCING_PRICE_BELOW_FLOOR',
    });
  }
}

export function sourcedFigures(
  agreed: Prisma.Decimal,
  q: ReturnType<typeof quote>,
) {
  return {
    subtotal: q.subtotal,
    serviceFee: agreed.sub(q.subtotal).sub(q.agentCommission),
    agentCommission: q.agentCommission,
    commissions: q.commissions,
    deliveryFee: new Prisma.Decimal(0),
    totalPrice: agreed,
  };
}
