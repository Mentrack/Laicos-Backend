import {
  FarmVerificationStatus,
  Prisma,
  ProduceStatus,
  type User,
} from '../../../generated/client';
import { farmOwnedBy } from '../../common/ownership';

// A farmer sees all their own produce. Everyone else, guests included, sees
// only listings that are out of draft on a farm an agent has verified.
export function visibleTo(user: User | null): Prisma.ProduceWhereInput {
  const shoppable: Prisma.ProduceWhereInput = {
    status: { not: ProduceStatus.DRAFT },
    farm: { verificationStatus: FarmVerificationStatus.VERIFIED },
  };
  return { OR: user ? [shoppable, { farm: farmOwnedBy(user) }] : [shoppable] };
}
