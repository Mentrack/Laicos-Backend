import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  HandoverStatus,
  OrderStatus,
  Prisma,
  ProduceType,
  type Agent,
} from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { HandoverService } from '../handover.service';

const agent = { id: 'agent-1', isVerified: true } as Agent;
const orderId = '9d2e7c4a-1b3f-4e5d-8a6b-7c8d9e0f1a2b';

function row(overrides: Record<string, unknown> = {}) {
  return {
    orderId,
    agentId: agent.id,
    status: HandoverStatus.PENDING,
    verificationNote: null,
    verifiedAt: null,
    recipientName: null,
    recipientPhone: null,
    handoverNote: null,
    handedOverAt: null,
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-01'),
    order: {
      id: orderId,
      orderNumber: 'ORD-000001',
      produceName: 'Maize',
      quantity: 12.5,
      type: ProduceType.LOCAL,
      produce: { unit: 'tons' },
      farm: {
        id: 'farm-1',
        farmCode: 'LF-000001',
        name: 'Green Acres',
        location: 'Bodija',
        state: { id: 'state-1', name: 'Oyo' },
        lga: { id: 'lga-1', stateId: 'state-1', name: 'Ibadan North' },
        size: 5,
        unit: 'ha',
        mainProduce: 'Maize',
      },
    },
    ...overrides,
  };
}

describe('HandoverService', () => {
  const orderHandover = {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  };
  const order = { update: jest.fn() };
  const tx = { orderHandover, order };
  const database = {
    ...tx,
    $transaction: (
      arg: Promise<unknown>[] | ((client: typeof tx) => Promise<unknown>),
    ) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg)),
  };
  const service = new HandoverService(database as unknown as PrismaService);

  beforeEach(() => {
    jest.resetAllMocks();
    orderHandover.findFirst.mockResolvedValue(row());
    orderHandover.updateMany.mockResolvedValue({ count: 1 });
  });

  it('lists only the agent’s own handovers', async () => {
    orderHandover.findMany.mockResolvedValue([row()]);
    orderHandover.count.mockResolvedValue(1);
    const { data } = await service.findAll(agent, {
      status: HandoverStatus.PENDING,
    });
    expect(orderHandover.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { agentId: agent.id, status: HandoverStatus.PENDING },
      }),
    );
    expect(data[0]).toMatchObject({ orderId, unit: 'tons', quantity: 12.5 });
  });

  it('404s another agent’s handover', async () => {
    orderHandover.findFirst.mockResolvedValue(null);
    await expect(service.findOne(agent, orderId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(orderHandover.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId, agentId: agent.id } }),
    );
  });

  describe('verify', () => {
    it('moves a pending handover to VERIFIED', async () => {
      await service.verify(agent, orderId, { note: 'All bags weighed' });
      expect(orderHandover.updateMany).toHaveBeenCalledWith({
        where: { orderId, agentId: agent.id, status: HandoverStatus.PENDING },
        data: {
          status: HandoverStatus.VERIFIED,
          verificationNote: 'All bags weighed',
          verifiedAt: expect.any(Date),
        },
      });
    });

    it('409s a handover already verified', async () => {
      orderHandover.updateMany.mockResolvedValue({ count: 0 });
      orderHandover.findFirst.mockResolvedValue(
        row({ status: HandoverStatus.VERIFIED }),
      );
      await expect(service.verify(agent, orderId, {})).rejects.toThrow(
        'Only a pending handover can be verified; this one is VERIFIED',
      );
    });

    it('404s when the guarded write missed another agent’s handover', async () => {
      orderHandover.updateMany.mockResolvedValue({ count: 0 });
      orderHandover.findFirst.mockResolvedValue(null);
      await expect(service.verify(agent, orderId, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('complete', () => {
    const dto = { recipientName: 'Musa Ibrahim' };

    it('records the recipient and ships the READY order', async () => {
      await service.complete(agent, orderId, dto);
      expect(orderHandover.updateMany).toHaveBeenCalledWith({
        where: { orderId, agentId: agent.id, status: HandoverStatus.VERIFIED },
        data: {
          status: HandoverStatus.HANDED_OVER,
          recipientName: 'Musa Ibrahim',
          recipientPhone: null,
          handoverNote: null,
          handedOverAt: expect.any(Date),
        },
      });
      expect(order.update).toHaveBeenCalledWith({
        where: { id: orderId, status: OrderStatus.READY },
        data: { status: OrderStatus.SHIPPED },
      });
    });

    it('refuses to hand over an unverified order', async () => {
      orderHandover.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.complete(agent, orderId, dto)).rejects.toThrow(
        'Verify the order before handing it over; this one is PENDING',
      );
      expect(order.update).not.toHaveBeenCalled();
    });

    it('409s when the order is no longer READY', async () => {
      order.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('boom', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );
      await expect(
        service.complete(agent, orderId, dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
