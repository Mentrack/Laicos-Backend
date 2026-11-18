import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma, SourcingRequest } from '../../../generated/client';
import { SourcingRequestStatus as S } from '../../../generated/client';

export type SourcingActor = 'ADMIN' | 'AGENT' | 'SYSTEM';

type Moves = Partial<Record<S, readonly S[]>>;

const TRANSITIONS: Record<SourcingActor, Moves> = {
  ADMIN: {
    PENDING: [S.ASSIGNED, S.CLOSED],
    ASSIGNED: [S.ASSIGNED, S.CLOSED],
    FINDING_SUPPLY: [S.CLOSED],
    NEGOTIATING: [S.CLOSED],
    CONFIRMED: [S.CLOSED],
  },
  AGENT: {
    ASSIGNED: [S.FINDING_SUPPLY, S.PENDING],
    FINDING_SUPPLY: [S.NEGOTIATING],
    NEGOTIATING: [S.FINDING_SUPPLY, S.CONFIRMED],
    CONFIRMED: [S.NEGOTIATING],
  },
  SYSTEM: {
    ASSIGNED: [S.PENDING],
    CONFIRMED: [S.FINDING_SUPPLY, S.NEGOTIATING, S.COMPLETED, S.CLOSED],
    COMPLETED: [S.FULFILLED, S.CLOSED],
  },
};

export function canMove(from: S, to: S, actor: SourcingActor): boolean {
  return TRANSITIONS[actor][from]?.includes(to) ?? false;
}

/** Callers write the audit row. */
export async function moveSourcingStatus(
  tx: Prisma.TransactionClient,
  requestId: string,
  to: S,
  actor: SourcingActor,
): Promise<SourcingRequest> {
  const request = await tx.sourcingRequest.findUnique({
    where: { id: requestId },
  });
  if (!request) {
    throw new NotFoundException('Sourcing request not found');
  }
  if (!canMove(request.status, to, actor)) {
    throw new ConflictException({
      message: `A ${request.status} request cannot move to ${to}`,
      code: 'SOURCING_INVALID_TRANSITION',
    });
  }
  return tx.sourcingRequest.update({
    where: { id: requestId },
    data: { status: to },
  });
}
