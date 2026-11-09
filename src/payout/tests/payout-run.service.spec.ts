import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DisputeStatus,
  PayeeRole,
  PayoutItemKind,
  PayoutStatus,
  Prisma,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import type { PaystackClient } from '../../paystack/paystack.client';
import { PaystackError } from '../../paystack/paystack-error';
import { NotificationService } from '../../notifications/notification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PayoutConfig } from '../payout.config';
import { PayoutRunService } from '../payout-run.service';
import { PayoutService } from '../payout.service';

const d = (value: string) => new Prisma.Decimal(value);
const now = new Date('2026-11-05T12:00:00Z');

type FakeOrder = {
  id: string;
  farmer: string;
  agent: string | null;
  totalPrice: Prisma.Decimal;
  agentCommission: Prisma.Decimal;
  refundPercent?: string;
  reversedAt?: Date[];
};

type Where = Record<string, unknown> & {
  AND?: Record<string, unknown>[];
  payoutItems?: { none: { kind: PayoutItemKind } };
};

function kindOf(where: Where): PayoutItemKind {
  return (where.payoutItems as { none: { kind: PayoutItemKind } }).none.kind;
}

// payeeIs() for each kind, read back.
function payeeOf(where: Record<string, unknown>): string {
  const farm = where.farm as { owner: { user: { id: string } } } | undefined;
  if (farm) {
    return farm.owner.user.id;
  }
  const handover = where.handover as {
    is: { agent: { is: { user: { id: string } } } };
  };
  return handover.is.agent.is.user.id;
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
  });
}

describe('PayoutRunService', () => {
  let orders: FakeOrder[];
  const locks: string[] = [];
  const database = {
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
    order: { findMany: jest.fn() },
    bankAccount: { findUnique: jest.fn() },
    payout: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    payoutItem: { updateMany: jest.fn() },
  };
  const paystack = { bulkTransfer: jest.fn() };
  const config = new PayoutConfig(new ConfigService({}));
  const payouts = new PayoutService(
    database as unknown as PrismaService,
    paystack as unknown as PaystackClient,
    {} as AuditService,
    {} as NotificationService,
  );
  const service = new PayoutRunService(
    database as unknown as PrismaService,
    payouts,
    config,
  );
  let created: number;

  function payeeOfOrder(order: FakeOrder, kind: PayoutItemKind) {
    return kind === PayoutItemKind.PRODUCE ? order.farmer : order.agent;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    locks.length = 0;
    created = 0;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    database.$transaction.mockImplementation((work: unknown) =>
      typeof work === 'function'
        ? (work as (client: typeof database) => Promise<unknown>)(database)
        : Promise.all(work as Promise<unknown>[]),
    );
    database.$executeRaw.mockImplementation((_sql: unknown, key: string) => {
      locks.push(key);
      return Promise.resolve(1);
    });
    database.bankAccount.findUnique.mockImplementation(
      ({ where }: { where: { userId: string } }) =>
        Promise.resolve({
          userId: where.userId,
          bankName: 'GTBank',
          accountNumber: '0123456789',
          accountName: 'ADA OKAFOR',
          recipientCode: `RCP_${where.userId}`,
          updatedAt: new Date('2026-11-01T00:00:00Z'),
        }),
    );
    database.order.findMany.mockImplementation(
      ({ where }: { where: Where }) => {
        if (!where.AND) {
          const kind = kindOf(where);
          return Promise.resolve(
            orders
              .filter((order) => payeeOfOrder(order, kind))
              .map((order) => ({
                farm: { owner: { userId: order.farmer } },
                handover: order.agent
                  ? { agent: { userId: order.agent } }
                  : null,
              })),
          );
        }
        const [eligible, payee] = where.AND;
        const kind = kindOf(eligible);
        const userId = payeeOf(payee);
        return Promise.resolve(
          orders
            .filter((order) => payeeOfOrder(order, kind) === userId)
            .map((order) => ({
              id: order.id,
              orderNumber: `ORD-${order.id}`,
              totalPrice: order.totalPrice,
              agentCommission: order.agentCommission,
              dispute: order.refundPercent
                ? {
                    status: DisputeStatus.RESOLVED,
                    refundPercent: d(order.refundPercent),
                  }
                : null,
              handover: order.agent
                ? { agentId: `agent-${order.agent}` }
                : null,
              payoutItems: (order.reversedAt ?? []).map((updatedAt) => ({
                payout: { updatedAt },
              })),
            })),
        );
      },
    );
    database.payout.create.mockImplementation(
      ({
        data,
      }: {
        data: {
          payeeId: string;
          amount: Prisma.Decimal;
          recipientCode: string;
        };
      }) => {
        created += 1;
        return Promise.resolve({
          id: `payout-${data.payeeId}`,
          reference: `PO-${String(created).padStart(6, '0')}`,
          status: PayoutStatus.PENDING,
          items: [],
          ...data,
        });
      },
    );
    database.payout.update.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id }),
    );
    paystack.bulkTransfer.mockResolvedValue([]);
  });

  function createdData() {
    return database.payout.create.mock.calls.map(
      ([args]: [{ data: Record<string, unknown> }]) => args.data,
    );
  }

  it('creates one payout per payee: produce for the farmer, commission for the agent', async () => {
    orders = [
      {
        id: 'o1',
        farmer: 'user-f',
        agent: 'user-g',
        totalPrice: d('4000.00'),
        agentCommission: d('200.00'),
      },
      {
        id: 'o2',
        farmer: 'user-f',
        agent: null,
        totalPrice: d('5000.00'),
        agentCommission: d('250.00'),
      },
    ];
    await expect(service.run(now)).resolves.toEqual({ payouts: 2 });
    const [farmer, agent] = createdData();
    expect(farmer).toEqual({
      payeeId: 'user-f',
      payeeRole: PayeeRole.FARMER,
      amount: d('9000.00'),
      bankName: 'GTBank',
      accountNumber: '0123456789',
      accountName: 'ADA OKAFOR',
      recipientCode: 'RCP_user-f',
      items: {
        create: [
          { kind: PayoutItemKind.PRODUCE, orderId: 'o1', amount: d('4000.00') },
          { kind: PayoutItemKind.PRODUCE, orderId: 'o2', amount: d('5000.00') },
        ],
      },
    });
    expect(agent).toMatchObject({
      payeeId: 'user-g',
      payeeRole: PayeeRole.AGENT,
      amount: d('200.00'),
      items: {
        create: [
          {
            kind: PayoutItemKind.COMMISSION,
            orderId: 'o1',
            amount: d('200.00'),
          },
        ],
      },
    });
    // o2's handover agent is gone, so its commission stays with Laicos.
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('ORD-o2'),
    );
    // Automatic: nobody approved it.
    for (const data of createdData()) {
      expect(data.approvedById ?? null).toBeNull();
    }
    expect(paystack.bulkTransfer).toHaveBeenCalledTimes(1);
    expect(paystack.bulkTransfer).toHaveBeenCalledWith([
      expect.objectContaining({ amount: 900_000, recipient: 'RCP_user-f' }),
      expect.objectContaining({ amount: 20_000, recipient: 'RCP_user-g' }),
    ]);
  });

  it('takes each payee lock in its own transaction, in sorted user id order', async () => {
    orders = [
      {
        id: 'o1',
        farmer: 'user-c',
        agent: 'user-a',
        totalPrice: d('100'),
        agentCommission: d('5'),
      },
      {
        id: 'o2',
        farmer: 'user-b',
        agent: 'user-a',
        totalPrice: d('100'),
        agentCommission: d('5'),
      },
    ];
    await service.run(now);
    expect(locks).toEqual([
      'payout:user:user-a',
      'payout:user:user-b',
      'payout:user:user-c',
    ]);
    expect(database.$transaction).toHaveBeenCalledTimes(3);
  });

  it('pays the kept share after a partial dispute refund, rounded down', async () => {
    orders = [
      {
        id: 'o1',
        farmer: 'user-f',
        agent: 'user-g',
        totalPrice: d('1000.00'),
        agentCommission: d('50.00'),
        refundPercent: '30',
      },
    ];
    await service.run(now);
    const [farmer, agent] = createdData();
    expect(farmer.items).toEqual({
      create: [
        { kind: PayoutItemKind.PRODUCE, orderId: 'o1', amount: d('700.00') },
      ],
    });
    expect(agent.items).toEqual({
      create: [
        { kind: PayoutItemKind.COMMISSION, orderId: 'o1', amount: d('35.00') },
      ],
    });
  });

  it('creates nothing for a fully refunded order', async () => {
    orders = [
      {
        id: 'o1',
        farmer: 'user-f',
        agent: 'user-g',
        totalPrice: d('1000.00'),
        agentCommission: d('50.00'),
        refundPercent: '100',
      },
    ];
    await expect(service.run(now)).resolves.toEqual({ payouts: 0 });
    expect(database.payout.create).not.toHaveBeenCalled();
    expect(paystack.bulkTransfer).not.toHaveBeenCalled();
  });

  it('holds a reversed order until the payee changes their account', async () => {
    orders = [
      {
        id: 'o1',
        farmer: 'user-f',
        agent: null,
        totalPrice: d('1000.00'),
        agentCommission: d('50.00'),
        // After the account's updatedAt in the bankAccount mock.
        reversedAt: [new Date('2026-11-02T00:00:00Z')],
      },
    ];
    await expect(service.run(now)).resolves.toEqual({ payouts: 0 });
  });

  it('sends 150 payouts in Paystack chunks of 100 and 50', async () => {
    orders = Array.from({ length: 150 }, (_, i) => ({
      id: `o${i}`,
      farmer: `user-${String(i).padStart(3, '0')}`,
      agent: null,
      totalPrice: d('100'),
      agentCommission: d('5'),
    }));
    await expect(service.run(now)).resolves.toEqual({ payouts: 150 });
    expect(
      paystack.bulkTransfer.mock.calls.map(
        ([batch]: [unknown[]]) => batch.length,
      ),
    ).toEqual([100, 50]);
  });

  it('skips a payee whose order already has a live item, and carries on', async () => {
    orders = [
      {
        id: 'o1',
        farmer: 'user-a',
        agent: null,
        totalPrice: d('100'),
        agentCommission: d('5'),
      },
      {
        id: 'o2',
        farmer: 'user-b',
        agent: null,
        totalPrice: d('200'),
        agentCommission: d('10'),
      },
    ];
    database.payout.create.mockRejectedValueOnce(prismaError('P2002'));
    await expect(service.run(now)).resolves.toEqual({ payouts: 1 });
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('user-a'),
    );
    expect(paystack.bulkTransfer).toHaveBeenCalledWith([
      expect.objectContaining({ recipient: 'RCP_user-b' }),
    ]);
  });

  it('a failing payee mid-run still lets the others be created and sent, then fails the run', async () => {
    orders = ['user-a', 'user-b', 'user-c'].map((farmer, i) => ({
      id: `o${i}`,
      farmer,
      agent: null,
      totalPrice: d('100'),
      agentCommission: d('5'),
    }));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    database.payout.create
      .mockImplementationOnce(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: `payout-${String(data.payeeId)}`,
          items: [],
          ...data,
        }),
      )
      .mockRejectedValueOnce(prismaError('P2028'));
    await expect(service.run(now)).rejects.toThrow(
      'Payout run incomplete: 1 payee(s) and 0 chunk(s) failed',
    );
    expect(database.payout.create).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('user-b'),
      expect.anything(),
    );
    expect(paystack.bulkTransfer).toHaveBeenCalledTimes(1);
    expect(paystack.bulkTransfer).toHaveBeenCalledWith([
      expect.objectContaining({ recipient: 'RCP_user-a' }),
      expect.objectContaining({ recipient: 'RCP_user-c' }),
    ]);
  });

  it('a non-Paystack throw in one chunk still sends the next, then fails the run', async () => {
    orders = Array.from({ length: 150 }, (_, i) => ({
      id: `o${i}`,
      farmer: `user-${String(i).padStart(3, '0')}`,
      agent: null,
      totalPrice: d('100'),
      agentCommission: d('5'),
    }));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    paystack.bulkTransfer
      .mockResolvedValueOnce([
        { reference: 'payout-user-000', transferCode: 'TRF' },
      ])
      .mockResolvedValueOnce([]);
    // Paystack queued chunk 1, then storing its transfer codes failed.
    database.payout.update.mockRejectedValueOnce(new Error('connection lost'));
    await expect(service.run(now)).rejects.toThrow(
      'Payout run incomplete: 0 payee(s) and 1 chunk(s) failed',
    );
    expect(
      paystack.bulkTransfer.mock.calls.map(
        ([batch]: [unknown[]]) => batch.length,
      ),
    ).toEqual([100, 50]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('payout-user-000'),
      expect.anything(),
    );
  });

  it('fails the payouts when Paystack definitely rejects the transfer', async () => {
    orders = [
      {
        id: 'o1',
        farmer: 'user-a',
        agent: null,
        totalPrice: d('100'),
        agentCommission: d('5'),
      },
    ];
    paystack.bulkTransfer.mockRejectedValue(
      new PaystackError('Insufficient balance', 400),
    );
    database.payout.findMany.mockResolvedValue([]);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    await service.run(now);
    expect(database.payout.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['payout-user-a'] }, status: PayoutStatus.PENDING },
      data: {
        status: PayoutStatus.FAILED,
        failureReason: 'Insufficient balance',
      },
    });
    expect(database.payoutItem.updateMany).toHaveBeenCalledWith({
      where: {
        payoutId: { in: ['payout-user-a'] },
        status: PayoutStatus.PENDING,
      },
      data: { status: PayoutStatus.FAILED },
    });
  });

  it('does nothing when nothing is eligible', async () => {
    orders = [];
    await expect(service.run(now)).resolves.toEqual({ payouts: 0 });
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(paystack.bulkTransfer).not.toHaveBeenCalled();
  });
});
