import { Prisma } from '../../../generated/client';
import { commissionFor, orderPaidAmount } from '../utils/order-share';

const d = (value: string | number) => new Prisma.Decimal(value);

describe('orderPaidAmount', () => {
  it('adds its commission and share of the service fee, not delivery', () => {
    expect(
      orderPaidAmount(
        { totalPrice: d(1000), agentCommission: d(50) },
        { serviceFee: d(25), subtotal: d(500) },
      ).toFixed(2),
    ).toBe('1100.00');
  });
});

describe('commissionFor', () => {
  it('rounds a line commission to kobo', () => {
    expect(commissionFor(d('1000.10'), d(5)).toFixed(2)).toBe('50.01');
    expect(commissionFor(d('333.33'), d(5)).toFixed(2)).toBe('16.67');
  });
});
