import { Prisma } from '../../../generated/client';
import { ngnToUsd, percentOf, proportionalShare, toMinorUnits } from '../money';

const d = (value: string) => new Prisma.Decimal(value);

describe('money', () => {
  it('converts to integer minor units without float drift', () => {
    expect(toMinorUnits(d('37.58'))).toBe(3758);
    expect(toMinorUnits(d('0.29'))).toBe(29);
    expect(toMinorUnits(d('57500'))).toBe(5_750_000);
  });

  it('takes a percentage rounded half up to 2 dp', () => {
    expect(percentOf(d('54000'), d('5')).toFixed(2)).toBe('2700.00');
    expect(percentOf(d('0.30'), d('5')).toFixed(2)).toBe('0.02');
    expect(percentOf(d('0.10'), d('2.5')).toFixed(2)).toBe('0.00');
    expect(percentOf(d('1000'), d('0')).toFixed(2)).toBe('0.00');
  });

  it('rounds a USD charge up to the cent', () => {
    expect(ngnToUsd(d('57500'), d('1530.123456')).toFixed(2)).toBe('37.58');
    expect(ngnToUsd(d('1500'), d('1500')).toFixed(2)).toBe('1.00');
    expect(ngnToUsd(d('1500.01'), d('1500')).toFixed(2)).toBe('1.01');
  });

  it('rounds a proportional share down, so parts never exceed the whole', () => {
    const share = proportionalShare(d('100'), d('300'), d('10.00'));
    expect(share.toFixed(2)).toBe('3.33');
    expect(share.mul(3).lte(d('10.00'))).toBe(true);
    expect(proportionalShare(d('300'), d('300'), d('37.58')).toFixed(2)).toBe(
      '37.58',
    );
  });
});
