import { ConflictException } from '@nestjs/common';
import { Prisma, SourcingUnit } from '../../../generated/client';
import { testCheckoutConfig } from '../../payment/tests/checkout-config.fixture';
import {
  assertAgreedPrice,
  assertCovered,
  isCovered,
  quote,
  sourcedFigures,
  supplyCoverage,
} from '../utils/sourcing-pricing';

const D = (value: string | number) => new Prisma.Decimal(value);
const config = testCheckoutConfig({
  SERVICE_FEE_PERCENT: '5',
  AGENT_COMMISSION_PERCENT: '5',
});
const lines = [
  { quantity: 8000, agreedUnitPrice: D(250) },
  { quantity: 12000, agreedUnitPrice: D(260) },
];

describe('sourcing pricing', () => {
  it('quotes subtotal, fees and the suggested price', () => {
    const q = quote(lines, config);
    expect(q.subtotal.toFixed(2)).toBe('5120000.00');
    expect(q.serviceFee.toFixed(2)).toBe('256000.00');
    expect(q.agentCommission.toFixed(2)).toBe('256000.00');
    expect(q.suggestedPrice.toFixed(2)).toBe('5632000.00');
    expect(q.commissions.map((c) => c.toFixed(2))).toEqual([
      '100000.00',
      '156000.00',
    ]);
  });

  it('floors the agreed price at the suggested price', () => {
    const suggested = D('5632000.00');
    expect(() => assertAgreedPrice(D('5631999.99'), suggested)).toThrow(
      ConflictException,
    );
    expect(() => assertAgreedPrice(D('5632000.00'), suggested)).not.toThrow();
    expect(() => assertAgreedPrice(D(6000000), suggested)).not.toThrow();
  });

  it('gives the service fee whatever the agreed price leaves over', () => {
    const figures = sourcedFigures(D(6000000), quote(lines, config));
    expect(figures.serviceFee.toFixed(2)).toBe('624000.00');
    expect(figures.totalPrice.toFixed(2)).toBe('6000000.00');
    expect(figures.deliveryFee.toFixed(2)).toBe('0.00');
  });

  it('quotes lines in their own units at their own prices', () => {
    // 8 t as kg at N250/kg and 12 t at N240,000/t: money needs no conversion.
    const q = quote(
      [
        { quantity: 8000, agreedUnitPrice: D(250) },
        { quantity: 12, agreedUnitPrice: D(240000) },
      ],
      config,
    );
    expect(q.subtotal.toFixed(2)).toBe('4880000.00');
  });

  it('converts kg and tonnes into the request unit for coverage', () => {
    const tonnes = { quantity: 20, unit: SourcingUnit.TONNES };
    expect(
      isCovered(tonnes, [
        { quantity: 8000, unit: SourcingUnit.KG },
        { quantity: 12, unit: SourcingUnit.TONNES },
      ]),
    ).toBe(true);
    expect(
      isCovered(tonnes, [{ quantity: 19999.6, unit: SourcingUnit.KG }]),
    ).toBe(false);
    expect(isCovered(tonnes, [{ quantity: 12, unit: SourcingUnit.BAGS }])).toBe(
      false,
    );
    expect(
      isCovered({ quantity: 20000, unit: SourcingUnit.KG }, [
        { quantity: 20, unit: SourcingUnit.TONNES },
      ]),
    ).toBe(true);
    expect(
      isCovered({ quantity: 50, unit: SourcingUnit.BAGS }, [
        { quantity: 30, unit: SourcingUnit.BAGS },
        { quantity: 25, unit: SourcingUnit.BAGS },
      ]),
    ).toBe(true);
  });

  it('reports coverage from the same whole-kilogram base as isCovered', () => {
    expect(
      supplyCoverage({ quantity: 0.3, unit: SourcingUnit.TONNES }, [
        { quantity: 100, unit: SourcingUnit.KG },
      ]),
    ).toEqual({ requested: 0.3, selected: 0.1, remaining: 0.2 });
    expect(
      supplyCoverage({ quantity: 20, unit: SourcingUnit.TONNES }, [
        { quantity: 8000, unit: SourcingUnit.KG },
        { quantity: 13, unit: SourcingUnit.TONNES },
      ]),
    ).toEqual({ requested: 20, selected: 21, remaining: 0 });
    // isCovered rounds a kg request to whole kilograms; the display agrees.
    const kg = { quantity: 100.5, unit: SourcingUnit.KG };
    const lines = [{ quantity: 101, unit: SourcingUnit.KG }];
    expect(isCovered(kg, lines)).toBe(true);
    expect(supplyCoverage(kg, lines)).toEqual({
      requested: 101,
      selected: 101,
      remaining: 0,
    });
    expect(
      supplyCoverage({ quantity: 10, unit: SourcingUnit.BAGS }, [
        { quantity: 4, unit: SourcingUnit.BAGS },
      ]),
    ).toEqual({ requested: 10, selected: 4, remaining: 6 });
  });

  it('409s SOURCING_NOT_COVERED when the lines fall short', () => {
    const tonnes = { quantity: 20, unit: SourcingUnit.TONNES };
    const short = () =>
      assertCovered(tonnes, [{ quantity: 19, unit: SourcingUnit.TONNES }]);
    expect(short).toThrow(ConflictException);
    expect(short).toThrow('Accepted offers do not cover the request yet');
    expect(() =>
      assertCovered(tonnes, [{ quantity: 20, unit: SourcingUnit.TONNES }]),
    ).not.toThrow();
  });
});
