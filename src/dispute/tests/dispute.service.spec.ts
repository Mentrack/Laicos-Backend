import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  DisputeStatus,
  NotificationType,
  OrderStatus,
  PaymentStatus,
  PayoutStatus,
  Role,
} from '../../../generated/client';
import type { AuditService } from '../../audit/audit.service';
import { IMAGE_SIGNATURES } from '../../common/upload-pipes';
import type { NotificationService } from '../../notifications/notification.service';
import type { RefundService } from '../../payment/refund.service';
import { PayoutConfig } from '../../payout/payout.config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StorageService } from '../../storage/storage.service';
import { DisputeService } from '../dispute.service';
import {
  HOUR_MS,
  adminUser,
  buyerUser,
  d,
  disputeRow,
  errorBody,
  jpeg,
  knownError,
  orderRow,
  refundRow,
} from './dispute.fixture';

describe('DisputeService', () => {
  const events: string[] = [];
  const tx = {
    $executeRaw: jest.fn(),
    order: {
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    dispute: { create: jest.fn(), update: jest.fn() },
    user: { findMany: jest.fn() },
    payment: { findUniqueOrThrow: jest.fn() },
  };
  const database = {
    order: { findFirst: jest.fn() },
    dispute: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    payment: { findFirst: jest.fn() },
    $transaction: async (
      arg: ((client: typeof tx) => Promise<unknown>) | Promise<unknown>[],
    ) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      const result = await arg(tx);
      events.push('commit');
      return result;
    },
  };
  const storage = {
    uploadPrivateFile: jest.fn(),
    deletePrivate: jest.fn(),
    getPresignedUrl: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const notification = { notify: jest.fn(), dispatch: jest.fn() };
  const refunds = { createForDispute: jest.fn(), submit: jest.fn() };
  const service = new DisputeService(
    database as unknown as PrismaService,
    storage as unknown as StorageService,
    audit as unknown as AuditService,
    notification as unknown as NotificationService,
    refunds as unknown as RefundService,
    new PayoutConfig(new ConfigService({})),
  );
  const raiseDto = { reason: 'Half the bags were wet', quantityAffected: 2 };

  beforeEach(() => {
    jest.resetAllMocks();
    events.length = 0;
    database.order.findFirst.mockResolvedValue(orderRow());
    tx.order.findUniqueOrThrow.mockResolvedValue(orderRow());
    tx.order.findMany.mockResolvedValue([orderRow()]);
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.dispute.create.mockResolvedValue(disputeRow());
    tx.dispute.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(disputeRow(data)),
    );
    tx.user.findMany.mockResolvedValue([{ id: 'admin-a' }, { id: 'admin-b' }]);
    tx.payment.findUniqueOrThrow.mockResolvedValue({ id: 'pay-1' });
    database.dispute.findUnique.mockResolvedValue(disputeRow());
    database.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      reference: 'PAY-000001',
    });
    storage.uploadPrivateFile
      .mockResolvedValueOnce('disputes/order-1/a.jpg')
      .mockResolvedValueOnce('disputes/order-1/b.jpg');
    storage.getPresignedUrl.mockResolvedValue('https://signed');
    notification.notify.mockResolvedValue(['delivery-1']);
    refunds.createForDispute.mockResolvedValue(refundRow());
    refunds.submit.mockImplementation(() => {
      events.push('submit');
      return Promise.resolve(refundRow());
    });
    notification.dispatch.mockImplementation(() => {
      events.push('dispatch');
      return Promise.resolve();
    });
  });

  describe('raise', () => {
    it('opens a dispute on a shipped order with its photos', async () => {
      const result = await service.raise(buyerUser, 'order-1', raiseDto, [
        jpeg(),
        jpeg(),
      ]);

      expect(result).toMatchObject({
        id: 'dispute-1',
        status: DisputeStatus.OPEN,
        photos: [{ id: 'photo-1', url: 'https://signed' }],
      });
      expect(database.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1', buyer: { userId: buyerUser.id } },
        }),
      );
      expect(storage.uploadPrivateFile).toHaveBeenCalledWith(
        'disputes/order-1',
        expect.anything(),
        IMAGE_SIGNATURES,
      );
      expect(tx.dispute.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            orderId: 'order-1',
            raisedById: buyerUser.id,
            reason: raiseDto.reason,
            quantityAffected: 2,
            photos: {
              create: [
                { key: 'disputes/order-1/a.jpg' },
                { key: 'disputes/order-1/b.jpg' },
              ],
            },
          },
        }),
      );
    });

    it('tells every admin, the farmer and the agent, after commit', async () => {
      await service.raise(buyerUser, 'order-1', raiseDto, [jpeg()]);

      expect(tx.user.findMany).toHaveBeenCalledWith({
        where: { role: Role.ADMIN },
        select: { id: true },
      });
      expect(notification.notify).toHaveBeenCalledWith(
        {
          userIds: ['admin-a', 'admin-b', 'farmer-user', 'agent-user'],
          type: NotificationType.DISPUTE_RAISED,
          params: {
            disputeId: 'dispute-1',
            orderId: 'order-1',
            orderNumber: 'ORD-000001',
            reason: raiseDto.reason,
          },
        },
        tx,
      );
      expect(notification.dispatch).toHaveBeenCalledWith(['delivery-1']);
      expect(events).toEqual(['commit', 'dispatch']);
    });

    it('records a buyer audit row', async () => {
      await service.raise(buyerUser, 'order-1', raiseDto, [jpeg()]);

      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          actorType: AuditActorType.BUYER,
          farmId: 'farm-1',
          category: AuditCategory.DISPUTE,
          title: 'Dispute raised',
          resource: AuditResource.DISPUTE,
          resourceId: 'dispute-1',
        }),
      );
    });

    it('allows a fulfilled order 23h after delivery', async () => {
      const fulfilled = orderRow({
        status: OrderStatus.FULFILLED,
        fulfilledAt: new Date(Date.now() - 23 * HOUR_MS),
      });
      database.order.findFirst.mockResolvedValue(fulfilled);
      tx.order.findUniqueOrThrow.mockResolvedValue(fulfilled);

      await expect(
        service.raise(buyerUser, 'order-1', raiseDto, [jpeg()]),
      ).resolves.toMatchObject({ id: 'dispute-1' });
    });

    it('refuses a fulfilled order 25h after delivery', async () => {
      database.order.findFirst.mockResolvedValue(
        orderRow({
          status: OrderStatus.FULFILLED,
          fulfilledAt: new Date(Date.now() - 25 * HOUR_MS),
        }),
      );

      const { status, body } = await errorBody(
        service.raise(buyerUser, 'order-1', raiseDto, [jpeg()]),
      );
      expect(status).toBe(409);
      expect(body).toMatchObject({ code: 'DISPUTE_WINDOW_CLOSED' });
      expect(storage.uploadPrivateFile).not.toHaveBeenCalled();
    });

    it('refuses an order that never shipped', async () => {
      database.order.findFirst.mockResolvedValue(
        orderRow({ status: OrderStatus.READY }),
      );

      const { body } = await errorBody(
        service.raise(buyerUser, 'order-1', raiseDto, [jpeg()]),
      );
      expect(body).toMatchObject({ code: 'DISPUTE_WINDOW_CLOSED' });
    });

    it('refuses, under the payee locks, an order that already has a live payout item', async () => {
      tx.order.findUniqueOrThrow.mockResolvedValue(
        orderRow({ payoutItems: [{ id: 'item-1' }] }),
      );

      const { status, body } = await errorBody(
        service.raise(buyerUser, 'order-1', raiseDto, [jpeg()]),
      );
      expect(status).toBe(409);
      expect(body).toMatchObject({ code: 'DISPUTE_WINDOW_CLOSED' });
      expect(tx.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'order-1' } }),
      );
      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        'payout:user:agent-user',
      );
      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        'payout:user:farmer-user',
      );
      const lastLock = Math.max(...tx.$executeRaw.mock.invocationCallOrder);
      expect(tx.order.findUniqueOrThrow.mock.invocationCallOrder[0]).toBe(
        lastLock + 1,
      );
      expect(tx.order.findUniqueOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            payoutItems: {
              where: {
                status: { in: [PayoutStatus.PENDING, PayoutStatus.SUCCEEDED] },
              },
              select: { id: true },
              take: 1,
            },
          }) as unknown,
        }),
      );
      expect(tx.dispute.create).not.toHaveBeenCalled();
    });

    it('refuses a second dispute', async () => {
      database.order.findFirst.mockResolvedValue(
        orderRow({ dispute: { id: 'dispute-0' } }),
      );

      const { status, body } = await errorBody(
        service.raise(buyerUser, 'order-1', raiseDto, [jpeg()]),
      );
      expect(status).toBe(409);
      expect(body).toMatchObject({ code: 'DISPUTE_EXISTS' });
    });

    it('turns a racing duplicate on orderId into DISPUTE_EXISTS', async () => {
      tx.dispute.create.mockRejectedValue(knownError('P2002'));

      const { body } = await errorBody(
        service.raise(buyerUser, 'order-1', raiseDto, [jpeg()]),
      );
      expect(body).toMatchObject({ code: 'DISPUTE_EXISTS' });
    });

    it('rejects more affected units than the order has', async () => {
      const { status, body } = await errorBody(
        service.raise(
          buyerUser,
          'order-1',
          { ...raiseDto, quantityAffected: 11 },
          [jpeg()],
        ),
      );
      expect(status).toBe(400);
      expect(body).toMatchObject({ code: 'INVALID_QUANTITY' });
    });

    it("hides another buyer's order", async () => {
      database.order.findFirst.mockResolvedValue(null);

      const { status } = await errorBody(
        service.raise(buyerUser, 'order-1', raiseDto, [jpeg()]),
      );
      expect(status).toBe(404);
    });

    it('uploads before the transaction and deletes the uploads when it fails', async () => {
      tx.order.findUniqueOrThrow.mockResolvedValue(
        orderRow({ payoutItems: [{ id: 'item-1' }] }),
      );

      await errorBody(
        service.raise(buyerUser, 'order-1', raiseDto, [jpeg(), jpeg()]),
      );
      expect(
        storage.uploadPrivateFile.mock.invocationCallOrder[1],
      ).toBeLessThan(tx.order.findMany.mock.invocationCallOrder[0]);
      expect(storage.deletePrivate).toHaveBeenCalledWith([
        'disputes/order-1/a.jpg',
        'disputes/order-1/b.jpg',
      ]);
    });

    it('deletes the photos already uploaded when a later upload fails', async () => {
      storage.uploadPrivateFile
        .mockReset()
        .mockResolvedValueOnce('disputes/order-1/a.jpg')
        .mockRejectedValueOnce(new Error('S3 down'));

      await expect(
        service.raise(buyerUser, 'order-1', raiseDto, [jpeg(), jpeg()]),
      ).rejects.toThrow('S3 down');
      expect(storage.deletePrivate).toHaveBeenCalledWith([
        'disputes/order-1/a.jpg',
      ]);
      expect(tx.order.findMany).not.toHaveBeenCalled();
    });
  });

  describe('resolve', () => {
    it('at 0% resolves without a refund and fulfils a shipped order', async () => {
      await service.resolve(adminUser, 'dispute-1', {
        refundPercent: 0,
        note: 'Agent replaced the bags',
      });

      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        'payment:pay-1',
      );
      expect(tx.dispute.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dispute-1', status: DisputeStatus.OPEN },
          data: expect.objectContaining({
            status: DisputeStatus.RESOLVED,
            refundPercent: d('0'),
            resolutionNote: 'Agent replaced the bags',
            resolvedById: adminUser.id,
            resolvedAt: expect.any(Date) as unknown,
          }) as unknown,
        }),
      );
      expect(tx.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', status: OrderStatus.SHIPPED },
        data: {
          status: OrderStatus.FULFILLED,
          fulfilledAt: expect.any(Date) as unknown,
        },
      });
      expect(refunds.createForDispute).not.toHaveBeenCalled();
      expect(refunds.submit).not.toHaveBeenCalled();
    });

    it('tells the buyer, farmer and agent, after commit', async () => {
      await service.resolve(adminUser, 'dispute-1', {
        refundPercent: 0,
        note: 'n',
      });

      expect(notification.notify).toHaveBeenCalledWith(
        {
          userIds: [buyerUser.id, 'farmer-user', 'agent-user'],
          type: NotificationType.DISPUTE_RESOLVED,
          params: {
            disputeId: 'dispute-1',
            orderId: 'order-1',
            orderNumber: 'ORD-000001',
            refundPercent: '0.00',
          },
        },
        tx,
      );
      expect(events).toEqual(['commit', 'dispatch']);
    });

    it('records an admin audit row', async () => {
      await service.resolve(adminUser, 'dispute-1', {
        refundPercent: 0,
        note: 'n',
      });

      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          actorType: AuditActorType.ADMIN,
          farmId: 'farm-1',
          category: AuditCategory.DISPUTE,
          title: 'Dispute resolved',
          resource: AuditResource.DISPUTE,
          resourceId: 'dispute-1',
        }),
      );
    });

    it('at 30% creates the refund in the transaction and submits it after commit', async () => {
      const payment = {
        id: 'pay-1',
        reference: 'PAY-000001',
        status: PaymentStatus.SUCCEEDED,
      };
      tx.payment.findUniqueOrThrow.mockResolvedValue(payment);

      await service.resolve(adminUser, 'dispute-1', {
        refundPercent: 30,
        note: 'Partly spoiled',
      });

      expect(database.payment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { checkoutId: 'checkout-1', status: PaymentStatus.SUCCEEDED },
        }),
      );
      expect(tx.payment.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        include: { checkout: true, refunds: true },
      });
      expect(refunds.createForDispute).toHaveBeenCalledWith(
        tx,
        payment,
        expect.objectContaining({ id: 'order-1' }),
        expect.objectContaining({ id: 'dispute-1', refundPercent: d('30') }),
        adminUser,
      );
      expect(refunds.submit).toHaveBeenCalledWith(refundRow(), 'PAY-000001');
      expect(events).toEqual(['commit', 'submit', 'dispatch']);
    });

    it('refuses a dispute that is no longer open', async () => {
      tx.dispute.update.mockRejectedValue(knownError('P2025'));

      const { status, body } = await errorBody(
        service.resolve(adminUser, 'dispute-1', {
          refundPercent: 0,
          note: 'n',
        }),
      );
      expect(status).toBe(409);
      expect(body).toMatchObject({ code: 'DISPUTE_RESOLVED' });
    });

    it('rolls back, leaving the dispute open, when the refund exceeds the balance', async () => {
      refunds.createForDispute.mockRejectedValue(
        new ConflictException({
          message: 'Only 10.00 is left to refund on this payment',
          code: 'REFUND_EXCEEDS_BALANCE',
        }),
      );

      const { status, body } = await errorBody(
        service.resolve(adminUser, 'dispute-1', {
          refundPercent: 30,
          note: 'n',
        }),
      );
      expect(status).toBe(409);
      expect(body).toMatchObject({ code: 'REFUND_EXCEEDS_BALANCE' });
      // The throw escaped the transaction callback, so Postgres rolls the
      // dispute update back: nothing committed, nothing sent.
      expect(events).toEqual([]);
      expect(refunds.submit).not.toHaveBeenCalled();
      expect(notification.dispatch).not.toHaveBeenCalled();
    });

    it('404s an unknown dispute', async () => {
      database.dispute.findUnique.mockResolvedValue(null);

      const { status, body } = await errorBody(
        service.resolve(adminUser, 'dispute-x', {
          refundPercent: 0,
          note: 'n',
        }),
      );
      expect(status).toBe(404);
      expect(body).toMatchObject({ code: 'DISPUTE_NOT_FOUND' });
    });
  });

  describe('findForOrder', () => {
    it('scopes a non-admin to orders they buy, grow or hand over', async () => {
      database.dispute.findFirst.mockResolvedValue(disputeRow());

      await service.findForOrder(buyerUser, 'order-1');

      expect(database.dispute.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            orderId: 'order-1',
            order: {
              OR: [
                { buyer: { userId: buyerUser.id } },
                { farm: { owner: { userId: buyerUser.id } } },
                { handover: { agent: { userId: buyerUser.id } } },
              ],
            },
          },
        }),
      );
    });

    it('lets an admin see any order', async () => {
      database.dispute.findFirst.mockResolvedValue(disputeRow());

      await service.findForOrder(adminUser, 'order-1');

      expect(database.dispute.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orderId: 'order-1', order: {} } }),
      );
    });

    it('404s an unrelated buyer', async () => {
      database.dispute.findFirst.mockResolvedValue(null);

      const { status, body } = await errorBody(
        service.findForOrder(buyerUser, 'order-1'),
      );
      expect(status).toBe(404);
      expect(body).toMatchObject({ code: 'DISPUTE_NOT_FOUND' });
    });
  });

  describe('findAll', () => {
    it('lists by status, oldest first', async () => {
      database.dispute.findMany.mockResolvedValue([disputeRow()]);
      database.dispute.count.mockResolvedValue(1);

      const result = await service.findAll({
        page: 1,
        perPage: 20,
        status: DisputeStatus.OPEN,
      });

      expect(database.dispute.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: DisputeStatus.OPEN },
          orderBy: { createdAt: 'asc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.metaData).toMatchObject({ total: 1 });
    });
  });
});
