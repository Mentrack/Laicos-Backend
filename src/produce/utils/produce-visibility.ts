import {
  FarmVerificationStatus,
  Prisma,
  ProduceStatus,
  type User,
} from '../../../generated/client';
import { farmOwnedBy } from '../../common/ownership';

// SOURCED listings only back sourced orders, so no one browses, edits or carts
// them. Admin views and farm counts reuse this.
export const notSourced = {
  status: { not: ProduceStatus.SOURCED },
} satisfies Prisma.ProduceWhereInput;

// Still on sale: shown in the shop and as a farm's listings.
export const ON_SALE_STATUSES = [
  ProduceStatus.PUBLISHED,
  ProduceStatus.SOLD_OUT,
];

// A farmer sees all their own produce bar SOURCED. Everyone else, guests
// included, sees only listings still on sale (published or sold out) on a
// verified farm. DISABLED and DRAFT stay off the shop.
export function visibleTo(user: User | null): Prisma.ProduceWhereInput {
  const shoppable: Prisma.ProduceWhereInput = {
    status: { in: ON_SALE_STATUSES },
    farm: { verificationStatus: FarmVerificationStatus.VERIFIED },
  };
  return {
    OR: user
      ? [shoppable, { farm: farmOwnedBy(user), ...notSourced }]
      : [shoppable],
  };
}
