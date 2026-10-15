import type { Buyer, Lga, State } from '../../../generated/client';
import type { BuyerDto, BuyerProfileDto } from '../dto';

type BuyerWithLocation = Buyer & {
  state: State | null;
  lga: Lga | null;
};

export function toBuyerDto(buyer: Pick<Buyer, 'id' | 'buyerId'>): BuyerDto {
  return { id: buyer.id, buyerId: buyer.buyerId };
}

export function toBuyerProfileDto(buyer: BuyerWithLocation): BuyerProfileDto {
  return {
    ...toBuyerDto(buyer),
    userId: buyer.userId,
    buyerType: buyer.buyerType,
    legalName: buyer.legalName,
    department: buyer.department,
    contactName: buyer.contactName,
    contactPhone: buyer.contactPhone,
    paymentTerms: buyer.paymentTerms,
    state: buyer.state,
    lga: buyer.lga,
    createdAt: buyer.createdAt,
    updatedAt: buyer.updatedAt,
  };
}
