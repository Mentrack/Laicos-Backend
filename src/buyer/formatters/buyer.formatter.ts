import {
  BuyerType,
  type Buyer,
  type Lga,
  type State,
} from '../../../generated/client';
import { fullName } from '../../common/names';
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

export function buyerDisplayName(buyer: {
  buyerType: BuyerType;
  legalName: string | null;
  user: { firstName: string; lastName: string };
}): string {
  if (buyer.buyerType === BuyerType.COMPANY && buyer.legalName) {
    return buyer.legalName;
  }
  return fullName(buyer.user);
}
