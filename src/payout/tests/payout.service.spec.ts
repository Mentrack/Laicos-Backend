import { ConfigService } from '@nestjs/config';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  PayoutStatus,
  Prisma,
  Role,
  type User,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import type { PaystackClient } from '../../paystack/paystack.client';
import { PaystackError } from '../../paystack/paystack-error';
import { PrismaService } from '../../prisma/prisma.service';
import { PayoutConfig } from '../payout.config';
import { PayoutService } from '../payout.service';

const admin = { id: 'admin-1', role: Role.ADMIN } as User;
const d = (value: string) => new Prisma.Decimal(value);
const FARMER_A = '00000000-0000-4000-8000-00000000000a';
const FARMER_B = '00000000-0000-4000-8000-00000000000b';

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
    farmerId: FARMER_A,
    amount: d('9000'),
    status: PayoutStatus.PENDING,
    transferCode: null,
    failureReason: null,
    paidAt: null,
    createdAt: new Date(),
    items: [],
    ...account(),
    ...overrides,
  };
}

describe('PayoutService', () => {
  const tx = {
    $executeRaw: jest.fn(),
    farmer: { findUnique: jest.fn() },
    order: { findMany: jest.fn() },
    payout: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    payoutItem: { updateMany: jest.fn() },
  };
  const database = {
    payout: { update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    payoutItem: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const paystack = { bulkTransfer: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new PayoutService(
    database as unknown as PrismaService,
    paystack as unknown as PaystackClient,
    new PayoutConfig(new ConfigService({})),
    audit as unknown as AuditService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    database.$transaction.mockImplementation((work: unknown) =>
      typeof work === 'function'
        ? (work as (client: typeof tx) => Promise<unknown>)(tx)
        : Promise.all(work as Promise<unknown>[]),
    );
    tx.farmer.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id, bankAccount: account() }),
    );
    tx.order.findMany.mockResolvedValue([
      { id: 'order-1', totalPrice: d('4000') },
      { id: 'order-2', totalPrice: d('5000') },
    ]);
    tx.payout.create.mockImplementation(
      ({ data }: { data: { farmerId: string } }) =>
        Promise.resolve(
          payoutRow({
            id: `payout-${data.farmerId.slice(-1)}`,
            farmerId: data.farmerId,
          }),
        ),
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

  describe('approve', () => {
    it('creates one payout per farmer for all their eligible orders, then transfers', async () => {
      const result = await service.approve(admin, { farmerIds: [FARMER_A] });
      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        `payout:farmer:${FARMER_A}`,
      );
      expect(tx.payout.create).toHaveBeenCalledWith({
        data: {
          farmerId: FARMER_A,
          amount: d('9000'),
          bankName: 'GTBank',
          accountNumber: '0123456789',
          accountName: 'ADA OKAFOR',
          recipientCode: 'RCP_a',
          approvedById: admin.id,
          items: {
            create: [
              { orderId: 'order-1', amount: d('4000') },
              { orderId: 'order-2', amount: d('5000') },
            ],
          },
        },
        include: { items: true },
      });
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
      expect(result.skippedFarmerIds).toEqual([]);
      expect(result.payouts[0]).toMatchObject({
        reference: 'PO-000001',
        amount: '9000.00',
        accountNumber: '******6789',
      });
    });

    it('skips farmers with nothing eligible or no account', async () => {
      tx.farmer.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === FARMER_B ? { id: FARMER_B, bankAccount: null } : null,
          ),
      );
      const result = await service.approve(admin, {
        farmerIds: [FARMER_B, FARMER_A],
      });
      expect(result.skippedFarmerIds).toEqual([FARMER_A, FARMER_B]);
      expect(paystack.bulkTransfer).not.toHaveBeenCalled();
    });

    it('leaves payouts Paystack did not acknowledge pending without a code', async () => {
      paystack.bulkTransfer.mockResolvedValue([
        { reference: 'payout-a', transferCode: 'TRF_a' },
      ]);
      await service.approve(admin, { farmerIds: [FARMER_A, FARMER_B] });
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
      const result = await service.approve(admin, { farmerIds: [FARMER_A] });
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
      expect(result.payouts[0].status).toBe(PayoutStatus.FAILED);
    });
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
        const result = await service.approve(admin, { farmerIds: [FARMER_A] });
        expect(database.payout.updateMany).not.toHaveBeenCalled();
        expect(database.payoutItem.updateMany).not.toHaveBeenCalled();
        expect(result.payouts[0].status).toBe(PayoutStatus.PENDING);
      });
    },
  );

  describe('applyTransferResult', () => {
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
          farmerId: FARMER_A,
        }),
      );
      await service.applyTransferResult({
        reference: 'payout-a',
        outcome: 'success',
        reason: null,
      });
      expect(audit.record).toHaveBeenCalledWith(tx, {
        actorType: AuditActorType.FARMER,
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
          farmerId: FARMER_A,
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
          farmerId: FARMER_A,
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
