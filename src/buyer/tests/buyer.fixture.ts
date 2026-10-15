import { BuyerType } from '../../../generated/client';

/** Buyer row for service specs. id matches the test user's id so existing
 *  buyerId: user.id assertions keep working; production ids are never equal. */
export function buyerProfile(userId = 'buyer-1') {
  return {
    id: userId,
    buyerId: 'BY-000001',
    userId,
    stateId: null,
    lgaId: null,
    buyerType: BuyerType.PERSON,
    legalName: null,
    department: null,
    contactName: null,
    contactPhone: null,
    paymentTerms: null,
    createdAt: new Date('2026-10-01'),
    updatedAt: new Date('2026-10-01'),
  };
}
