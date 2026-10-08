import { CheckoutStatus, OrderStatus } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckoutExpiryService } from '../checkout-expiry.service';

const now = new Date('2026-10-08T12:00:00Z');
const past = new Date('2026-10-08T11:00:00Z');

describe('CheckoutExpiryService', () => {
  const tx = {
    $executeRaw: jest.fn(),
    checkout: { findUnique: jest.fn(), update: jest.fn() },
    order: { findMany: jest.fn(), updateMany: jest.fn() },
    payment: { updateMany: jest.fn() },
    produce: { update: jest.fn() },
  };
  const database = {
    checkout: { findMany: jest.fn() },
    $transaction: (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  const service = new CheckoutExpiryService(
    database as unknown as PrismaService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    tx.order.findMany.mockResolvedValue([]);
  });

  it('finds overdue unpaid checkouts, oldest first, in batches', async () => {
    database.checkout.findMany.mockResolvedValue([]);
    await expect(service.expireOverdue(now)).resolves.toBe(0);
    expect(database.checkout.findMany).toHaveBeenCalledWith({
      where: {
        status: CheckoutStatus.AWAITING_PAYMENT,
        expiresAt: { lt: now },
      },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: 100,
    });
  });

  it('expires each under its lock and cancels its orders', async () => {
    database.checkout.findMany.mockResolvedValue([{ id: 'a' }]);
    tx.checkout.findUnique.mockResolvedValue({
      id: 'a',
      status: CheckoutStatus.AWAITING_PAYMENT,
      expiresAt: past,
    });
    await expect(service.expireOverdue(now)).resolves.toBe(1);
    expect(tx.$executeRaw).toHaveBeenCalledWith(
      expect.anything(),
      'checkout:a',
    );
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { checkoutId: 'a', status: OrderStatus.AWAITING_PAYMENT },
      data: {
        status: OrderStatus.CANCELLED,
        cancellationReason: 'Payment not received',
      },
    });
    expect(tx.checkout.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: CheckoutStatus.EXPIRED } }),
    );
  });

  it.each([
    ['paid meanwhile', { status: CheckoutStatus.PAID, expiresAt: past }],
    [
      'extended meanwhile',
      {
        status: CheckoutStatus.AWAITING_PAYMENT,
        expiresAt: new Date('2026-10-09T12:00:00Z'),
      },
    ],
  ])('skips a checkout %s', async (_label, row) => {
    database.checkout.findMany.mockResolvedValue([{ id: 'a' }]);
    tx.checkout.findUnique.mockResolvedValue({ id: 'a', ...row });
    await expect(service.expireOverdue(now)).resolves.toBe(0);
    expect(tx.checkout.update).not.toHaveBeenCalled();
  });

  it('keeps going when one checkout fails', async () => {
    database.checkout.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    tx.checkout.findUnique
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        id: 'b',
        status: CheckoutStatus.AWAITING_PAYMENT,
        expiresAt: past,
      });
    await expect(service.expireOverdue(now)).resolves.toBe(1);
  });
});
