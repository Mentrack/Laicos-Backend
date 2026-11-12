import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  PayeeRole,
  PayoutStatus,
  Prisma,
  Role,
  type User,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import type { PaystackClient } from '../../paystack/paystack.client';
import { PaystackError } from '../../paystack/paystack-error';
import { NotificationService } from '../../notifications/notification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PayoutService } from '../payout.service';

const agentUser = { id: 'user-g', role: Role.EXTENSION_AGENT } as User;
const d = (value: string) => new Prisma.Decimal(value);
const FARMER_A = '00000000-0000-4000-8000-00000000000a';
const userOf = (farmerId: string) => `user-${farmerId.slice(-1)}`;

function account(overrides: Record<string, unknown> = {}) {
  return {
    bankName: 'GTBank',
    accountNumber: '0123456789',
    accountName: 'ADA OKAFOR',
    recipientCode: 'RCP_a',
    ...overrides,
  };
}

function payoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payout-a',
    reference: 'PO-000001',
    payeeId: userOf(FARMER_A),
    payeeRole: PayeeRole.FARMER,
    payee: { farmer: { id: FARMER_A }, agent: null },
    amount: d('9000'),
    status: PayoutStatus.PENDING,
    transferCode: null,
    failureReason: null,
    paidAt: null,
    approvedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
    ...account(),
    ...overrides,
  };
}

describe('PayoutService', () => {
  const tx = {
    $executeRaw: jest.fn(),
    payout: { findUnique: jest.fn(), update: jest.fn() },
    payoutItem: { updateMany: jest.fn() },
  };
  const database = {
    payout: {
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    payoutItem: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const paystack = { bulkTransfer: jest.fn() };
  const audit = { record: jest.fn() };
  const notification = { notify: jest.fn(), dispatch: jest.fn() };
  const service = new PayoutService(
    database as unknown as PrismaService,
    paystack as unknown as PaystackClient,
    audit as unknown as AuditService,
    notification as unknown as NotificationService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    database.$transaction.mockImplementation((work: unknown) =>
      typeof work === 'function'
        ? (work as (client: typeof tx) => Promise<unknown>)(tx)
        : Promise.all(work as Promise<unknown>[]),
    );
    database.payout.update.mockImplementation(
      ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => Promise.resolve(payoutRow({ id: where.id, ...data })),
    );
    paystack.bulkTransfer.mockResolvedValue([
      { reference: 'payout-a', transferCode: 'TRF_a' },
    ]);
  });

  describe('send', () => {
    const pending = [
      payoutRow(),
      payoutRow({
        id: 'payout-b',
        reference: 'PO-000002',
        recipientCode: 'RCP_b',
      }),
    ];

    it('transfers in one bulk call and stores the transfer codes', async () => {
      const sent = await service.send([pending[0]]);
      expect(paystack.bulkTransfer).toHaveBeenCalledWith([
        {
          amount: 900_000,
          recipient: 'RCP_a',
          reference: 'payout-a',
          reason: 'LAICOS payout PO-000001',
        },
      ]);
      expect(database.payout.update).toHaveBeenCalledWith({
        where: { id: 'payout-a' },
        data: { transferCode: 'TRF_a' },
        include: { items: true },
      });
      expect(sent[0]).toMatchObject({ transferCode: 'TRF_a' });
    });

    it('leaves payouts Paystack did not acknowledge pending without a code', async () => {
      await service.send(pending);
      expect(database.payout.update).toHaveBeenCalledWith({
        where: { id: 'payout-b' },
        data: { transferCode: null },
        include: { items: true },
      });
    });

    it('fails every payout in the batch when the bulk call fails, freeing the orders', async () => {
      paystack.bulkTransfer.mockRejectedValue(
        new PaystackError('Insufficient balance', 400),
      );
      database.payout.findMany.mockResolvedValue([
        payoutRow({ status: PayoutStatus.FAILED }),
      ]);
      const sent = await service.send([pending[0]]);
      expect(database.payout.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['payout-a'] }, status: PayoutStatus.PENDING },
        data: {
          status: PayoutStatus.FAILED,
          failureReason: 'Insufficient balance',
        },
      });
      expect(database.payoutItem.updateMany).toHaveBeenCalledWith({
        where: { payoutId: { in: ['payout-a'] }, status: PayoutStatus.PENDING },
        data: { status: PayoutStatus.FAILED },
      });
      expect(sent[0].status).toBe(PayoutStatus.FAILED);
    });

    describe.each([
      ['Paystack unreachable', null],
      ['Request timeout', 408],
      ['Server error', 502],
    ] as const)(
      'when the bulk outcome is unknown (%s)',
      (message, httpStatus) => {
        it('leaves the payouts pending so a retry cannot pay twice', async () => {
          paystack.bulkTransfer.mockRejectedValue(
            new PaystackError(message, httpStatus),
          );
          const sent = await service.send([pending[0]]);
          expect(database.payout.updateMany).not.toHaveBeenCalled();
          expect(database.payoutItem.updateMany).not.toHaveBeenCalled();
          expect(sent[0].status).toBe(PayoutStatus.PENDING);
        });
      },
    );
  });

  describe('findMine', () => {
    it("lists only the caller's SUCCEEDED payouts, farmer or agent", async () => {
      database.payout.findMany.mockResolvedValue([]);
      database.payout.count.mockResolvedValue(0);
      await service.findMine(agentUser, {});
      const where = {
        payeeId: agentUser.id,
        status: PayoutStatus.SUCCEEDED,
      };
      expect(database.payout.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where }),
      );
      expect(database.payout.count).toHaveBeenCalledWith({ where });
    });
  });

  describe('findAll', () => {
    it('filters by status and payee role', async () => {
      database.payout.findMany.mockResolvedValue([]);
      database.payout.count.mockResolvedValue(0);
      await service.findAll({
        status: PayoutStatus.FAILED,
        payeeRole: PayeeRole.AGENT,
      });
      expect(database.payout.count).toHaveBeenCalledWith({
        where: { status: PayoutStatus.FAILED, payeeRole: PayeeRole.AGENT },
      });
    });
  });

  describe('summary', () => {
    it("sums the caller's SUCCEEDED payouts", async () => {
      database.payout.aggregate.mockResolvedValue({
        _sum: { amount: d('9235.50') },
      });
      await expect(service.summary(agentUser)).resolves.toEqual({
        totalEarnings: '9235.50',
      });
      expect(database.payout.aggregate).toHaveBeenCalledWith({
        where: { payeeId: agentUser.id, status: PayoutStatus.SUCCEEDED },
        _sum: { amount: true },
      });
    });

    it('reports zero before anything is paid', async () => {
      database.payout.aggregate.mockResolvedValue({ _sum: { amount: null } });
      await expect(service.summary(agentUser)).resolves.toEqual({
        totalEarnings: '0.00',
      });
    });
  });

  describe('applyTransferResult', () => {
    beforeEach(() => {
      notification.notify.mockResolvedValue(['delivery-1']);
    });

    it('tells the payee a success landed, dispatching after commit', async () => {
      tx.payout.findUnique.mockResolvedValue(payoutRow());
      await service.applyTransferResult({
        reference: 'payout-a',
        outcome: 'success',
        reason: null,
      });
      expect(notification.notify).toHaveBeenCalledWith(
        {
          userIds: [userOf(FARMER_A)],
          type: 'PAYOUT_PAID',
          params: {
            payoutId: 'payout-a',
            reference: 'PO-000001',
            amount: '9000.00',
          },
        },
        tx,
      );
      expect(notification.dispatch).toHaveBeenCalledWith(['delivery-1']);
    });

    it('does not notify on a repeated success, failure or reversal', async () => {
      tx.payout.findUnique.mockResolvedValue(
        payoutRow({ status: PayoutStatus.SUCCEEDED }),
      );
      await service.applyTransferResult({
        reference: 'payout-a',
        outcome: 'success',
        reason: null,
      });
      tx.payout.findUnique.mockResolvedValue(payoutRow());
      await service.applyTransferResult({
        reference: 'payout-a',
        outcome: 'failed',
        reason: 'x',
      });
      await service.applyTransferResult({
        reference: 'payout-a',
        outcome: 'reversed',
        reason: 'x',
      });
      expect(notification.notify).not.toHaveBeenCalled();
      expect(notification.dispatch.mock.calls.flat(2)).toEqual([]);
    });

    it.each([
      ['success', PayoutStatus.SUCCEEDED],
      ['failed', PayoutStatus.FAILED],
      ['reversed', PayoutStatus.REVERSED],
    ] as const)('moves a pending payout on %s', async (outcome, status) => {
      tx.payout.findUnique.mockResolvedValue(payoutRow());
      await service.applyTransferResult({
        reference: 'payout-a',
        outcome,
        reason: outcome === 'success' ? null : 'Account closed',
      });
      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        'payout:payout-a',
      );
      expect(tx.payout.update).toHaveBeenCalledWith({
        where: { id: 'payout-a' },
        data:
          status === PayoutStatus.SUCCEEDED
            ? { status, paidAt: expect.any(Date) as Date, failureReason: null }
            : { status, failureReason: 'Account closed' },
      });
      expect(tx.payoutItem.updateMany).toHaveBeenCalledWith({
        where: { payoutId: 'payout-a' },
        data: { status },
      });
    });

    it('lets a reversal follow a success', async () => {
      tx.payout.findUnique.mockResolvedValue(
        payoutRow({ status: PayoutStatus.SUCCEEDED }),
      );
      await service.applyTransferResult({
        reference: 'payout-a',
        outcome: 'reversed',
        reason: null,
      });
      expect(tx.payout.update).toHaveBeenCalled();
    });

    it.each([
      [PayoutStatus.SUCCEEDED, 'success'],
      [PayoutStatus.FAILED, 'success'],
      [PayoutStatus.REVERSED, 'failed'],
    ] as const)('leaves a %s payout alone on %s', async (status, outcome) => {
      tx.payout.findUnique.mockResolvedValue(payoutRow({ status }));
      await service.applyTransferResult({
        reference: 'payout-a',
        outcome,
        reason: null,
      });
      expect(tx.payout.update).not.toHaveBeenCalled();
    });

    it('ignores an unknown reference', async () => {
      tx.payout.findUnique.mockResolvedValue(null);
      await service.applyTransferResult({
        reference: 'nope',
        outcome: 'success',
        reason: null,
      });
      expect(tx.payout.update).not.toHaveBeenCalled();
    });

    it('records a paid row once', async () => {
      tx.payout.findUnique.mockResolvedValue(
        payoutRow({
          amount: d('1200.00'),
          bankName: 'GTBank',
          reference: 'PO-000001',
          payee: { farmer: { id: FARMER_A }, agent: null },
        }),
      );
      await service.applyTransferResult({
        reference: 'payout-a',
        outcome: 'success',
        reason: null,
      });
      expect(audit.record).toHaveBeenCalledWith(tx, {
        actorType: AuditActorType.FARMER,
        actorUserId: userOf(FARMER_A),
        farmerId: FARMER_A,
        agentId: null,
        farmId: null,
        category: AuditCategory.PAYOUT,
        title: 'Payout PO-000001 paid',
        summary: '₦1200.00 to GTBank',
        actionLabel: 'View payout',
        resource: AuditResource.PAYOUT,
        resourceId: 'payout-a',
      });
    });

    it('records an agent payee as the extension agent', async () => {
      tx.payout.findUnique.mockResolvedValue(
        payoutRow({
          payeeId: agentUser.id,
          payeeRole: PayeeRole.AGENT,
          payee: { farmer: null, agent: { id: 'agent-1' } },
        }),
      );
      await service.applyTransferResult({
        reference: 'payout-a',
        outcome: 'success',
        reason: null,
      });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          actorType: AuditActorType.EXTENSION_AGENT,
          actorUserId: agentUser.id,
          farmerId: null,
          agentId: 'agent-1',
        }),
      );
    });

    it('records a payee whose profile is gone as the system', async () => {
      tx.payout.findUnique.mockResolvedValue(
        payoutRow({ payee: { farmer: null, agent: null } }),
      );
      await service.applyTransferResult({
        reference: 'payout-a',
        outcome: 'reversed',
        reason: null,
      });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          actorType: AuditActorType.SYSTEM,
          actorUserId: null,
          farmerId: null,
          agentId: null,
        }),
      );
    });

    it('a second success writes nothing', async () => {
      tx.payout.findUnique.mockResolvedValue(
        payoutRow({ status: PayoutStatus.SUCCEEDED }),
      );
      await service.applyTransferResult({
        reference: 'payout-a',
        outcome: 'success',
        reason: null,
      });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('a success after FAILED writes nothing', async () => {
      tx.payout.findUnique.mockResolvedValue(
        payoutRow({ status: PayoutStatus.FAILED }),
      );
      await service.applyTransferResult({
        reference: 'payout-a',
        outcome: 'success',
        reason: null,
      });
      expect(tx.payout.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('records a reversal', async () => {
      tx.payout.findUnique.mockResolvedValue(
        payoutRow({
          status: PayoutStatus.SUCCEEDED,
          reference: 'PO-000001',
          payee: { farmer: { id: FARMER_A }, agent: null },
        }),
      );
      await service.applyTransferResult({
        reference: 'payout-a',
        outcome: 'reversed',
        reason: 'Account closed',
      });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          title: 'Payout PO-000001 reversed',
          summary: 'Account closed',
          farmId: null,
          farmerId: FARMER_A,
        }),
      );
    });

    it('a failed transfer writes nothing', async () => {
      tx.payout.findUnique.mockResolvedValue(payoutRow());
      await service.applyTransferResult({
        reference: 'payout-a',
        outcome: 'failed',
        reason: 'Account closed',
      });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('a reversal without a reason uses the amount and bank', async () => {
      tx.payout.findUnique.mockResolvedValue(
        payoutRow({
          status: PayoutStatus.SUCCEEDED,
          amount: d('1200.00'),
          bankName: 'GTBank',
          reference: 'PO-000001',
          payee: { farmer: { id: FARMER_A }, agent: null },
        }),
      );
      await service.applyTransferResult({
        reference: 'payout-a',
        outcome: 'reversed',
        reason: null,
      });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ summary: '₦1200.00 to GTBank' }),
      );
    });
  });
});
