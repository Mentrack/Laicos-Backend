import { HttpException } from '@nestjs/common';
import {
  DisputeStatus,
  OrderStatus,
  Prisma,
  Role,
  type User,
} from '../../../generated/client';
import type { StorageUploadFile } from '../../common/upload-pipes';

export const d = (value: string) => new Prisma.Decimal(value);

export const buyerUser = { id: 'buyer-user', role: Role.BUYER } as User;
export const adminUser = { id: 'admin-user', role: Role.ADMIN } as User;

export const HOUR_MS = 3_600_000;

export function jpeg(): StorageUploadFile {
  return {
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    mimetype: 'image/jpeg',
    size: 4,
  };
}

// The order as the dispute service selects it.
export function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'ORD-000001',
    quantity: 10,
    status: OrderStatus.SHIPPED,
    fulfilledAt: null as Date | null,
    farmId: 'farm-1',
    checkoutId: 'checkout-1',
    totalPrice: d('9000'),
    agentCommission: d('450'),
    buyer: { userId: buyerUser.id },
    farm: { owner: { userId: 'farmer-user' } },
    handover: { agent: { userId: 'agent-user' } },
    dispute: null as { id: string } | null,
    payoutItems: [] as { id: string }[],
    ...overrides,
  };
}

export function disputeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dispute-1',
    orderId: 'order-1',
    raisedById: buyerUser.id,
    reason: 'Half the bags were wet',
    quantityAffected: 2,
    status: DisputeStatus.OPEN,
    refundPercent: null as Prisma.Decimal | null,
    resolutionNote: null as string | null,
    resolvedById: null as string | null,
    resolvedAt: null as Date | null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    photos: [
      {
        id: 'photo-1',
        disputeId: 'dispute-1',
        key: 'disputes/order-1/a.jpg',
        createdAt: new Date('2026-11-01T00:00:00Z'),
      },
    ],
    refunds: [],
    order: { orderNumber: 'ORD-000001', checkoutId: 'checkout-1' },
    ...overrides,
  };
}

export function refundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'refund-1',
    paymentId: 'pay-1',
    orderId: 'order-1',
    disputeId: 'dispute-1',
    amount: d('2970'),
    status: 'PENDING',
    reason: 'r',
    initiatedById: adminUser.id,
    providerRefundId: null,
    failureReason: null,
    createdAt: new Date('2026-11-02T00:00:00Z'),
    updatedAt: new Date('2026-11-02T00:00:00Z'),
    ...overrides,
  };
}

export async function errorBody(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpException);
  return {
    status: (error as HttpException).getStatus(),
    body: (error as HttpException).getResponse(),
  };
}

export function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: 'test',
  });
}
