import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  FarmVerificationStatus,
  Prisma,
  ProduceStatus,
  ProduceType,
  type Produce,
} from '../../../generated/client';
import {
  isOrderable,
  linePrice,
  orderLine,
  orderRefusal,
} from '../utils/reservation';

const produce = {
  id: 'produce-1',
  farmId: 'farm-1',
  name: 'Premium Cassava',
  unit: 'Tuber',
  floatingQuantity: 500,
  status: ProduceStatus.PUBLISHED,
  type: ProduceType.LOCAL,
  pricePerUnit: new Prisma.Decimal('4500.00'),
  farm: { verificationStatus: FarmVerificationStatus.VERIFIED },
} as Produce & { farm: { verificationStatus: FarmVerificationStatus } };

describe('reservation', () => {
  it('allows a quantity equal to the floating stock', () => {
    expect(isOrderable(produce, 500)).toBe(true);
    expect(isOrderable(produce, 500.5)).toBe(false);
  });

  it('refuses drafts and unverified farms as not found', () => {
    expect(isOrderable({ ...produce, status: ProduceStatus.DRAFT }, 1)).toBe(
      false,
    );
    expect(orderRefusal(null)).toBeInstanceOf(NotFoundException);
    expect(
      orderRefusal({
        ...produce,
        farm: { verificationStatus: FarmVerificationStatus.PENDING },
      }),
    ).toBeInstanceOf(NotFoundException);
  });

  it('refuses a sold-out listing as a conflict', () => {
    const refusal = orderRefusal({
      ...produce,
      status: ProduceStatus.SOLD_OUT,
    });
    expect(refusal).toBeInstanceOf(ConflictException);
    expect(refusal.message).toBe('Produce is not available for ordering');
  });

  it('names the floating stock when there is not enough', () => {
    expect(orderRefusal({ ...produce, floatingQuantity: 8 }).message).toBe(
      'Only 8 Tuber available',
    );
  });

  it('prices a line to 2 dp', () => {
    expect(linePrice(new Prisma.Decimal('350.50'), 3).toFixed(2)).toBe(
      '1051.50',
    );
  });

  it('builds the order fields from the produce', () => {
    expect(orderLine(produce, 10)).toEqual({
      produceId: 'produce-1',
      farmId: 'farm-1',
      quantity: 10,
      produceName: 'Premium Cassava',
      type: ProduceType.LOCAL,
      totalPrice: new Prisma.Decimal('45000'),
    });
  });
});
