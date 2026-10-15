import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  HandoverStatus,
  OrderStatus,
  Prisma,
  ProduceType,
  type Agent,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import type { StorageUploadFile } from '../../common/upload-pipes';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { HandoverService } from '../handover.service';

const agent = { id: 'agent-1', isVerified: true } as Agent;
const orderId = '9d2e7c4a-1b3f-4e5d-8a6b-7c8d9e0f1a2b';
const notFound = () =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code: 'P2025',
    clientVersion: 'test',
  });

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
    proofs: [],
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
    findFirstOrThrow: jest.fn(),
    update: jest.fn(),
  };
  const handoverProof = {
    create: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
  };
  const order = { update: jest.fn() };
  const tx = { orderHandover, order, handoverProof };
  const database = {
    ...tx,
    $transaction: (
      arg: Promise<unknown>[] | ((client: typeof tx) => Promise<unknown>),
    ) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg)),
  };
  const storage = {
    uploadPrivateFile: jest.fn(),
    deletePrivate: jest.fn(),
    getPresignedUrl: jest.fn((key: string) =>
      Promise.resolve(`https://signed/${key}`),
    ),
  };
  const audit = { record: jest.fn() };
  const service = new HandoverService(
    database as unknown as PrismaService,
    storage as unknown as StorageService,
    audit as unknown as AuditService,
  );
  const handoverAudit = (title: string) => ({
    actorType: AuditActorType.EXTENSION_AGENT,
    farmerId: null,
    agentId: agent.id,
    farmId: 'farm-1',
    category: AuditCategory.HANDOVER,
    title,
    summary: 'ORD-000001 at LF-000001',
    actionLabel: 'View order',
    resource: AuditResource.ORDER,
    resourceId: orderId,
  });
  const image: StorageUploadFile = {
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0]),
    mimetype: 'image/jpeg',
    size: 4,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    orderHandover.findFirst.mockResolvedValue(row());
    orderHandover.update.mockResolvedValue(row());
    order.update.mockResolvedValue(undefined);
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
    it('moves a pending handover to VERIFIED and returns it', async () => {
      orderHandover.update.mockResolvedValue(
        row({ status: HandoverStatus.VERIFIED }),
      );
      const result = await service.verify(agent, orderId, {
        note: 'All bags weighed',
      });
      expect(orderHandover.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orderId, agentId: agent.id, status: HandoverStatus.PENDING },
          data: {
            status: HandoverStatus.VERIFIED,
            verificationNote: 'All bags weighed',
            verifiedAt: expect.any(Date),
          },
        }),
      );
      expect(result).toMatchObject({
        orderId,
        status: HandoverStatus.VERIFIED,
      });
    });

    it('409s a handover already verified', async () => {
      orderHandover.update.mockRejectedValue(notFound());
      orderHandover.findFirst.mockResolvedValue(
        row({ status: HandoverStatus.VERIFIED }),
      );
      await expect(service.verify(agent, orderId, {})).rejects.toThrow(
        'Only a pending handover can be verified; this one is VERIFIED',
      );
    });

    it('404s when the guarded write missed another agent’s handover', async () => {
      orderHandover.update.mockRejectedValue(notFound());
      orderHandover.findFirst.mockResolvedValue(null);
      await expect(service.verify(agent, orderId, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('records the agent', async () => {
      orderHandover.update.mockResolvedValue(
        row({ status: HandoverStatus.VERIFIED }),
      );
      await service.verify(agent, orderId, {});
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        handoverAudit('Handover verified'),
      );
    });
  });

  describe('complete', () => {
    const dto = { recipientName: 'Musa Ibrahim' };

    it('records the recipient and ships the READY order', async () => {
      orderHandover.update.mockResolvedValue(
        row({ status: HandoverStatus.HANDED_OVER }),
      );
      const result = await service.complete(agent, orderId, dto);
      expect(orderHandover.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            orderId,
            agentId: agent.id,
            status: HandoverStatus.VERIFIED,
          },
          data: {
            status: HandoverStatus.HANDED_OVER,
            recipientName: 'Musa Ibrahim',
            recipientPhone: null,
            handoverNote: null,
            handedOverAt: expect.any(Date),
          },
        }),
      );
      expect(result).toMatchObject({
        orderId,
        status: HandoverStatus.HANDED_OVER,
      });
      expect(order.update).toHaveBeenCalledWith({
        where: { id: orderId, status: OrderStatus.READY },
        data: { status: OrderStatus.SHIPPED },
      });
    });

    it('refuses to hand over an unverified order', async () => {
      orderHandover.update.mockRejectedValue(notFound());
      await expect(service.complete(agent, orderId, dto)).rejects.toThrow(
        'Verify the order before handing it over; this one is PENDING',
      );
      expect(order.update).not.toHaveBeenCalled();
    });

    it('409s when the order is no longer READY', async () => {
      order.update.mockRejectedValue(notFound());
      await expect(
        service.complete(agent, orderId, dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('records the agent', async () => {
      orderHandover.update.mockResolvedValue(
        row({ status: HandoverStatus.HANDED_OVER }),
      );
      await service.complete(agent, orderId, dto);
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        handoverAudit('Handover completed'),
      );
    });
  });

  describe('addProof', () => {
    const proof = {
      id: 'proof-1',
      orderId,
      storageKey: 'handovers/order/x.jpg',
      createdAt: new Date('2026-09-01'),
    };

    beforeEach(() => {
      storage.uploadPrivateFile.mockResolvedValue(proof.storageKey);
      handoverProof.create.mockResolvedValue(proof);
      orderHandover.findFirst.mockResolvedValue(
        row({ proofs: [proof], status: HandoverStatus.PENDING }),
      );
      orderHandover.findFirstOrThrow.mockResolvedValue(
        row({ proofs: [proof], status: HandoverStatus.PENDING }),
      );
    });

    it('stores a photo on a pending handover and returns a signed URL', async () => {
      const result = await service.addProof(agent, orderId, image);
      expect(storage.uploadPrivateFile).toHaveBeenCalledWith(
        `handovers/${orderId}`,
        image,
        expect.any(Array),
      );
      expect(handoverProof.create).toHaveBeenCalledWith({
        data: { orderId, storageKey: proof.storageKey },
      });
      expect(result.proof).toEqual([
        {
          id: proof.id,
          url: `https://signed/${proof.storageKey}`,
          createdAt: proof.createdAt,
        },
      ]);
    });

    it('stores a photo after the goods are verified', async () => {
      orderHandover.findFirst
        .mockResolvedValueOnce(row({ status: HandoverStatus.VERIFIED }))
        .mockResolvedValueOnce(
          row({ proofs: [proof], status: HandoverStatus.VERIFIED }),
        );
      await expect(
        service.addProof(agent, orderId, image),
      ).resolves.toMatchObject({ status: HandoverStatus.VERIFIED });
      expect(handoverProof.create).toHaveBeenCalled();
    });

    it('does not upload once the order has been handed over', async () => {
      orderHandover.findFirst.mockResolvedValue(
        row({ status: HandoverStatus.HANDED_OVER }),
      );
      await expect(service.addProof(agent, orderId, image)).rejects.toThrow(
        'Proof cannot be added after handover; this one is HANDED_OVER',
      );
      expect(storage.uploadPrivateFile).not.toHaveBeenCalled();
    });

    it('404s another agent’s handover before uploading', async () => {
      orderHandover.findFirst.mockResolvedValue(null);
      await expect(
        service.addProof(agent, orderId, image),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.uploadPrivateFile).not.toHaveBeenCalled();
    });

    it('deletes the upload when recording it fails', async () => {
      handoverProof.create.mockRejectedValue(new Error('db down'));
      await expect(service.addProof(agent, orderId, image)).rejects.toThrow(
        'db down',
      );
      expect(storage.deletePrivate).toHaveBeenCalledWith([proof.storageKey]);
    });

    it('records the agent', async () => {
      await service.addProof(agent, orderId, image);
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        handoverAudit('Handover proof added'),
      );
    });
  });

  describe('removeProof', () => {
    const proofId = 'proof-1';
    const proof = {
      id: proofId,
      orderId,
      storageKey: 'handovers/order/x.jpg',
      createdAt: new Date('2026-09-01'),
      handover: { status: HandoverStatus.VERIFIED, agentId: agent.id },
    };

    it('deletes the photo and its stored file', async () => {
      handoverProof.findFirst.mockResolvedValue(proof);
      handoverProof.delete.mockResolvedValue(proof);
      orderHandover.findFirst.mockResolvedValue(row());
      await service.removeProof(agent, orderId, proofId);
      expect(handoverProof.findFirst).toHaveBeenCalledWith({
        where: { id: proofId, orderId, handover: { agentId: agent.id } },
        include: { handover: { select: { status: true, agentId: true } } },
      });
      expect(handoverProof.delete).toHaveBeenCalledWith({
        where: { id: proofId },
      });
      expect(storage.deletePrivate).toHaveBeenCalledWith([proof.storageKey]);
    });

    it('404s a photo that is not on this handover', async () => {
      handoverProof.findFirst.mockResolvedValue(null);
      await expect(
        service.removeProof(agent, orderId, proofId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(handoverProof.delete).not.toHaveBeenCalled();
    });

    it('does not delete a photo after handover', async () => {
      handoverProof.findFirst.mockResolvedValue({
        ...proof,
        handover: { status: HandoverStatus.HANDED_OVER, agentId: agent.id },
      });
      await expect(
        service.removeProof(agent, orderId, proofId),
      ).rejects.toThrow(
        'Proof cannot be removed after handover; this one is HANDED_OVER',
      );
      expect(handoverProof.delete).not.toHaveBeenCalled();
    });

    it('does not record an audit row', async () => {
      handoverProof.findFirst.mockResolvedValue(proof);
      handoverProof.delete.mockResolvedValue(proof);
      orderHandover.findFirst.mockResolvedValue(row());
      await service.removeProof(agent, orderId, proofId);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
