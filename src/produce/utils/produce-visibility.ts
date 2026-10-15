import {
  FarmVerificationStatus,
  Prisma,
  ProduceStatus,
  type User,
} from '../../../generated/client';
import { farmOwnedBy } from '../../common/ownership';

// A farmer sees all their own produce. Everyone else, guests included, sees
// only listings still on sale (published or sold out) on a verified farm.
// DISABLED and DRAFT stay off the shop.
export function visibleTo(user: User | null): Prisma.ProduceWhereInput {
  const shoppable: Prisma.ProduceWhereInput = {
    status: { in: [ProduceStatus.PUBLISHED, ProduceStatus.SOLD_OUT] },
    farm: { verificationStatus: FarmVerificationStatus.VERIFIED },
  };
  return { OR: user ? [shoppable, { farm: farmOwnedBy(user) }] : [shoppable] };
}
