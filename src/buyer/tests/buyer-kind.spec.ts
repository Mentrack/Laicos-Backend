import { BuyerType, Role } from '../../../generated/client';
import { buyerKindError } from '../utils/buyer-kind';

const company = {
  buyerType: BuyerType.COMPANY,
  legalName: 'Savannah Foods Ltd',
  department: 'Purchasing',
  contactName: 'Ibrahim Musa',
  contactPhone: '+2348032214400',
  paymentTerms: '50% advance, 50% on delivery',
};

describe('buyerKindError', () => {
  it('requires a type for a buyer and no company fields for a person', () => {
    expect(buyerKindError(Role.BUYER, {})).toBe('Buyer type is required');
    expect(
      buyerKindError(Role.BUYER, { buyerType: BuyerType.PERSON }),
    ).toBeNull();
    expect(
      buyerKindError(Role.BUYER, {
        buyerType: BuyerType.PERSON,
        legalName: 'Savannah Foods Ltd',
      }),
    ).toBe('A person cannot send company fields');
  });

  it('requires every company field, and rejects a rider who sends a type', () => {
    expect(buyerKindError(Role.BUYER, company)).toBeNull();
    expect(
      buyerKindError(Role.BUYER, { ...company, paymentTerms: '  ' }),
    ).toMatch(/company requires/i);
    expect(buyerKindError(Role.RIDER, {})).toBeNull();
    expect(
      buyerKindError(Role.RIDER, { buyerType: BuyerType.PERSON }),
    ).toBe('Only a buyer has a buyer type');
  });
});
