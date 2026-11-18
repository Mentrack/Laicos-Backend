import { SourcingRequestStatus, SourcingUnit } from '../../../generated/client';
import {
  OPEN_SOURCING_REQUEST,
  listingUnitWord,
  requestedAmount,
  unitsComparable,
} from '../utils/sourcing-rules';

describe('sourcing rules', () => {
  it('treats only FULFILLED and CLOSED as no longer open', () => {
    // COMPLETED means paid and in delivery, which still occupies the agent.
    expect(OPEN_SOURCING_REQUEST.status.notIn).toEqual([
      SourcingRequestStatus.FULFILLED,
      SourcingRequestStatus.CLOSED,
    ]);
  });

  it('rounds a tonne request half up to whole kilograms', () => {
    expect(requestedAmount(20, SourcingUnit.TONNES)).toBe(20000);
    expect(requestedAmount(0.0005, SourcingUnit.TONNES)).toBe(1);
    expect(requestedAmount(20.4, SourcingUnit.KG)).toBe(20);
  });

  it('keeps bags in the request unit', () => {
    expect(requestedAmount(10.5, SourcingUnit.BAGS)).toBe(10.5);
  });

  it('compares kg with tonnes both ways and every other unit only with itself', () => {
    expect(unitsComparable(SourcingUnit.TONNES, SourcingUnit.KG)).toBe(true);
    expect(unitsComparable(SourcingUnit.KG, SourcingUnit.TONNES)).toBe(true);
    expect(unitsComparable(SourcingUnit.KG, SourcingUnit.KG)).toBe(true);
    expect(unitsComparable(SourcingUnit.BAGS, SourcingUnit.BAGS)).toBe(true);
    expect(unitsComparable(SourcingUnit.BAGS, SourcingUnit.CRATES)).toBe(false);
    expect(unitsComparable(SourcingUnit.TONNES, SourcingUnit.BAGS)).toBe(false);
    expect(unitsComparable(SourcingUnit.LITRES, SourcingUnit.KG)).toBe(false);
  });

  it.each([
    [SourcingUnit.KG, 'kg'],
    [SourcingUnit.TONNES, 'tonnes'],
    [SourcingUnit.BAGS, 'bags'],
    [SourcingUnit.CRATES, 'crates'],
    [SourcingUnit.BASKETS, 'baskets'],
    [SourcingUnit.LITRES, 'litres'],
    [SourcingUnit.PIECES, 'pieces'],
  ])('words %s as %p for a listing', (unit, word) => {
    expect(listingUnitWord(unit)).toBe(word);
  });
});
