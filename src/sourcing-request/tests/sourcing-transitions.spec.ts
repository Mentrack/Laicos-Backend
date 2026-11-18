import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  AuditActorType,
  OrderStatus,
  SourcingRequestStatus as S,
  type Prisma,
} from '../../../generated/client';
import {
  canMove,
  moveSourcingStatus,
  type SourcingActor,
} from '../utils/sourcing-transitions';
import {
  lapseSourcedCheckout,
  syncSourcingRequest,
} from '../utils/sync-sourcing-request';

const allowed: [S, S, SourcingActor][] = [
  [S.PENDING, S.ASSIGNED, 'ADMIN'],
  [S.ASSIGNED, S.ASSIGNED, 'ADMIN'],
  [S.PENDING, S.CLOSED, 'ADMIN'],
  [S.ASSIGNED, S.CLOSED, 'ADMIN'],
  [S.FINDING_SUPPLY, S.CLOSED, 'ADMIN'],
  [S.NEGOTIATING, S.CLOSED, 'ADMIN'],
  [S.CONFIRMED, S.CLOSED, 'ADMIN'],
  [S.ASSIGNED, S.FINDING_SUPPLY, 'AGENT'],
  [S.ASSIGNED, S.PENDING, 'AGENT'],
  [S.FINDING_SUPPLY, S.NEGOTIATING, 'AGENT'],
  [S.NEGOTIATING, S.FINDING_SUPPLY, 'AGENT'],
  [S.NEGOTIATING, S.CONFIRMED, 'AGENT'],
  [S.CONFIRMED, S.NEGOTIATING, 'AGENT'],
  [S.ASSIGNED, S.PENDING, 'SYSTEM'],
  [S.CONFIRMED, S.FINDING_SUPPLY, 'SYSTEM'],
  [S.CONFIRMED, S.NEGOTIATING, 'SYSTEM'],
  [S.CONFIRMED, S.COMPLETED, 'SYSTEM'],
  [S.COMPLETED, S.FULFILLED, 'SYSTEM'],
  [S.COMPLETED, S.CLOSED, 'SYSTEM'],
  [S.CONFIRMED, S.CLOSED, 'SYSTEM'],
];

const refused: [S, S, SourcingActor][] = [
  [S.PENDING, S.ASSIGNED, 'AGENT'],
  [S.FINDING_SUPPLY, S.CONFIRMED, 'AGENT'],
  [S.FINDING_SUPPLY, S.ASSIGNED, 'ADMIN'],
  [S.COMPLETED, S.CLOSED, 'AGENT'],
  ...(['ADMIN', 'AGENT', 'SYSTEM'] as const).flatMap((actor) =>
    [S.FULFILLED, S.CLOSED].flatMap((from) =>
      Object.values(S).map((to): [S, S, SourcingActor] => [from, to, actor]),
    ),
  ),
];

describe('canMove', () => {
  it.each(allowed)('allows %s to %s by %s', (from, to, actor) => {
    expect(canMove(from, to, actor)).toBe(true);
  });

  it.each(refused)('refuses %s to %s by %s', (from, to, actor) => {
    expect(canMove(from, to, actor)).toBe(false);
  });
});

describe('moveSourcingStatus', () => {
  const sourcingRequest = { findUnique: jest.fn(), update: jest.fn() };
  const tx = { sourcingRequest } as unknown as Prisma.TransactionClient;

  beforeEach(() => jest.resetAllMocks());

  it('updates the status when the move is allowed', async () => {
    sourcingRequest.findUnique.mockResolvedValue({
      id: 'r1',
      status: S.PENDING,
    });
    sourcingRequest.update.mockResolvedValue({ id: 'r1', status: S.ASSIGNED });

    const row = await moveSourcingStatus(tx, 'r1', S.ASSIGNED, 'ADMIN');

    expect(row.status).toBe(S.ASSIGNED);
    expect(sourcingRequest.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: S.ASSIGNED },
    });
  });

  it('throws SOURCING_INVALID_TRANSITION for a refused move', async () => {
    sourcingRequest.findUnique.mockResolvedValue({
      id: 'r1',
      status: S.PENDING,
    });

    const error: unknown = await moveSourcingStatus(
      tx,
      'r1',
      S.ASSIGNED,
      'AGENT',
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'SOURCING_INVALID_TRANSITION',
    });
    expect(sourcingRequest.update).not.toHaveBeenCalled();
  });

  it('throws NotFound for a missing request', async () => {
    sourcingRequest.findUnique.mockResolvedValue(null);
    await expect(
      moveSourcingStatus(tx, 'r1', S.ASSIGNED, 'ADMIN'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('syncSourcingRequest', () => {
  const sourcingRequest = { findUnique: jest.fn(), update: jest.fn() };
  const auditEvent = { create: jest.fn() };
  const tx = {
    sourcingRequest,
    auditEvent,
  } as unknown as Prisma.TransactionClient;

  const audited = (title: string) =>
    expect(auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: 'SYSTEM',
        actorUserId: null,
        category: 'SOURCING',
        resource: 'SOURCING_REQUEST',
        sourcingRequestId: 'r1',
        title,
      }),
    });

  const found = (
    status: S,
    orders: OrderStatus[] | null,
    closeReason: string | null = null,
  ) =>
    sourcingRequest.findUnique.mockResolvedValue({
      id: 'r1',
      status,
      closeReason,
      checkouts:
        orders === null
          ? []
          : [{ status: 'PAID', orders: orders.map((o) => ({ status: o })) }],
    });

  beforeEach(() => {
    jest.resetAllMocks();
    sourcingRequest.update.mockResolvedValue({});
  });

  it('moves CONFIRMED to COMPLETED when the checkout is paid', async () => {
    found(S.CONFIRMED, [OrderStatus.PENDING]);
    await syncSourcingRequest(tx, 'r1');
    expect(sourcingRequest.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: S.COMPLETED },
    });
    audited('Payment received');
  });

  it('moves COMPLETED to FULFILLED when every order is fulfilled or cancelled', async () => {
    found(S.COMPLETED, [OrderStatus.FULFILLED, OrderStatus.CANCELLED]);
    await syncSourcingRequest(tx, 'r1');
    expect(sourcingRequest.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: S.FULFILLED },
    });
    audited('Request fulfilled');
  });

  it('closes when every paid order is cancelled', async () => {
    found(S.COMPLETED, [OrderStatus.CANCELLED]);
    await syncSourcingRequest(tx, 'r1');
    expect(sourcingRequest.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: {
        status: S.CLOSED,
        closedAt: expect.any(Date),
        closeReason: 'All orders were cancelled',
      },
    });
    audited('Request closed');
  });

  it('leaves FINDING_SUPPLY alone', async () => {
    found(S.FINDING_SUPPLY, null);
    await syncSourcingRequest(tx, 'r1');
    expect(sourcingRequest.update).not.toHaveBeenCalled();
    expect(auditEvent.create).not.toHaveBeenCalled();
  });

  it('leaves COMPLETED alone while an order is still open', async () => {
    found(S.COMPLETED, [OrderStatus.FULFILLED, OrderStatus.PREPARING]);
    await syncSourcingRequest(tx, 'r1');
    expect(sourcingRequest.update).not.toHaveBeenCalled();
    expect(auditEvent.create).not.toHaveBeenCalled();
  });
});

describe('lapseSourcedCheckout', () => {
  const cause = {
    actorType: AuditActorType.BUYER,
    actorUserId: 'u1',
    title: 'Checkout cancelled by buyer',
    summary: 'Cancelled by buyer',
  };
  const sourcingRequest = { findUnique: jest.fn(), update: jest.fn() };
  const sourcingContract = { updateMany: jest.fn() };
  const sourcingAllocation = { deleteMany: jest.fn() };
  const auditEvent = { create: jest.fn() };
  const tx = {
    sourcingRequest,
    sourcingContract,
    sourcingAllocation,
    auditEvent,
  } as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    jest.resetAllMocks();
    sourcingRequest.update.mockResolvedValue({});
  });

  it('voids the contract, reopens negotiation, keeps offers and audits once', async () => {
    sourcingRequest.findUnique.mockResolvedValue({
      id: 'r1',
      status: S.CONFIRMED,
    });
    await lapseSourcedCheckout(tx, 'r1', cause);
    expect(sourcingContract.updateMany).toHaveBeenCalledWith({
      where: { sourcingRequestId: 'r1', voidedAt: null },
      data: { voidedAt: expect.any(Date) },
    });
    expect(sourcingRequest.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: S.NEGOTIATING },
    });
    expect(sourcingAllocation.deleteMany).not.toHaveBeenCalled();
    expect(auditEvent.create).toHaveBeenCalledTimes(1);
    expect(auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: 'BUYER',
        actorUserId: 'u1',
        sourcingRequestId: 'r1',
        title: 'Checkout cancelled by buyer',
        summary: 'Cancelled by buyer',
      }),
    });
  });

  it.each([S.CLOSED, S.COMPLETED, S.NEGOTIATING])(
    'does nothing to a %s request',
    async (status) => {
      sourcingRequest.findUnique.mockResolvedValue({ id: 'r1', status });
      await lapseSourcedCheckout(tx, 'r1', cause);
      expect(sourcingContract.updateMany).not.toHaveBeenCalled();
      expect(sourcingRequest.update).not.toHaveBeenCalled();
      expect(auditEvent.create).not.toHaveBeenCalled();
    },
  );
});
