import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ProduceStatus,
  ProduceType,
  Role,
  type User,
} from '../../../generated/client';
import type { StorageUploadFile } from '../../common/upload-pipes';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { ProduceService } from '../produce.service';

const user = { id: 'user-1', role: Role.FARMER } as User;
const farmId = '6f1c1c3e-2b8e-4a55-9d0e-3b6b1f0c9a11';
const produceId = '0b7f5a52-6f3c-4f1e-9a57-2f7d8b3c1e22';
const ownedByUser = { owner: { userId: user.id } };
const visible = {
  OR: [{ status: { not: ProduceStatus.DRAFT } }, { farm: ownedByUser }],
};

// The leading bytes of a PNG, which IMAGE_SIGNATURES matches on.
const imageFile: StorageUploadFile = {
  buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
  mimetype: 'image/png',
  size: 10,
};
const imageUrl = 'https://cdn.example.com/produce/x.png';

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
  });
}

describe('ProduceService', () => {
  const farm = { findFirst: jest.fn() };
  const produce = {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const database = {
    farm,
    produce,
    // A plain function, not jest.fn, so resetAllMocks keeps it.
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  };
  const storage = { uploadPublic: jest.fn() };
  const service = new ProduceService(
    database as unknown as PrismaService,
    storage as unknown as StorageService,
  );
  const dto = {
    farmId,
    name: 'Maize',
    actualQuantity: 10,
    unit: 'kg',
    pricePerUnit: 100,
  };

  beforeEach(() => jest.resetAllMocks());

  describe('create', () => {
    beforeEach(() => {
      storage.uploadPublic.mockResolvedValue(imageUrl);
    });

    it('starts quantity, actualQuantity and floatingQuantity equal, DRAFT by default', async () => {
      farm.findFirst.mockResolvedValue({ id: farmId });
      await service.create(user, dto, imageFile);
      expect(farm.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: farmId, ...ownedByUser } }),
      );
      expect(produce.create).toHaveBeenCalledWith({
        data: {
          ...dto,
          id: expect.any(String),
          quantity: 10,
          floatingQuantity: 10,
          status: ProduceStatus.DRAFT,
          imageUrl,
        },
      });
    });

    it('is immediately SOLD_OUT when published with no stock', async () => {
      farm.findFirst.mockResolvedValue({ id: farmId });
      await service.create(
        user,
        { ...dto, actualQuantity: 0, status: ProduceStatus.PUBLISHED },
        imageFile,
      );
      expect(produce.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: ProduceStatus.SOLD_OUT }),
      });
    });

    it('stores the image under the id the row is created with', async () => {
      farm.findFirst.mockResolvedValue({ id: farmId });
      let key = '';
      storage.uploadPublic.mockImplementation((uploadKey: string) => {
        key = uploadKey;
        return Promise.resolve(imageUrl);
      });
      let id = '';
      produce.create.mockImplementation((args: { data: { id: string } }) => {
        id = args.data.id;
        return Promise.resolve(args.data);
      });

      await service.create(user, dto, imageFile);

      expect(key).toMatch(new RegExp(`^produce/${id}/.+\\.png$`));
      expect(storage.uploadPublic).toHaveBeenCalledWith(
        key,
        imageFile.buffer,
        'image/png',
      );
    });

    it('404s and uploads nothing when the farm is not the caller’s', async () => {
      farm.findFirst.mockResolvedValue(null);
      await expect(service.create(user, dto, imageFile)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(storage.uploadPublic).not.toHaveBeenCalled();
      expect(produce.create).not.toHaveBeenCalled();
    });
  });

  it('filters by status and type and hides other farmers’ drafts', async () => {
    produce.findMany.mockResolvedValue([]);
    produce.count.mockResolvedValue(3);
    const result = await service.findAll(user, {
      status: ProduceStatus.PUBLISHED,
      type: ProduceType.EXPORT,
    });
    const where = {
      ...visible,
      status: ProduceStatus.PUBLISHED,
      type: ProduceType.EXPORT,
      farmId: undefined,
    };
    expect(produce.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 0, take: 20 }),
    );
    expect(produce.count).toHaveBeenCalledWith({ where });
    expect(result.metaData.total).toBe(3);
  });

  it('404s on produce the user cannot see', async () => {
    produce.findFirst.mockResolvedValue(null);
    await expect(service.findOne(user, produceId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(produce.findFirst).toHaveBeenCalledWith({
      where: { id: produceId, ...visible },
    });
  });

  describe('update', () => {
    // 100 on hand, 30 reserved by pending orders.
    const current = {
      id: produceId,
      actualQuantity: 100,
      floatingQuantity: 70,
      unit: 'kg',
      status: ProduceStatus.PUBLISHED,
    };

    it('404s on produce the user does not own', async () => {
      produce.findFirst.mockResolvedValue(null);
      await expect(
        service.update(user, produceId, { name: 'New' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(produce.findFirst).toHaveBeenCalledWith({
        where: { id: produceId, farm: ownedByUser },
      });
      expect(produce.update).not.toHaveBeenCalled();
    });

    it('leaves quantities untouched when actualQuantity is not sent', async () => {
      produce.findFirst.mockResolvedValue(current);
      await service.update(user, produceId, { name: 'New' });
      expect(produce.update).toHaveBeenCalledWith({
        where: {
          id: produceId,
          actualQuantity: 100,
          floatingQuantity: 70,
        },
        data: {
          name: 'New',
          actualQuantity: 100,
          floatingQuantity: 70,
          status: ProduceStatus.PUBLISHED,
        },
      });
    });

    it('moves floatingQuantity by the same delta, guarded on what was read', async () => {
      produce.findFirst.mockResolvedValue(current);
      await service.update(user, produceId, { actualQuantity: 120 });
      expect(produce.update).toHaveBeenCalledWith({
        where: {
          id: produceId,
          actualQuantity: 100,
          floatingQuantity: 70,
        },
        data: {
          actualQuantity: 120,
          floatingQuantity: 90,
          status: ProduceStatus.PUBLISHED,
        },
      });
    });

    it('refuses to drop below what pending orders reserved', async () => {
      produce.findFirst.mockResolvedValue(current);
      await expect(
        service.update(user, produceId, { actualQuantity: 20 }),
      ).rejects.toThrow('30 kg is reserved by pending orders');
      expect(produce.update).not.toHaveBeenCalled();
    });

    it('flips to SOLD_OUT once actualQuantity is dropped to zero', async () => {
      produce.findFirst.mockResolvedValue({
        ...current,
        actualQuantity: 30,
        floatingQuantity: 30,
      });
      await service.update(user, produceId, { actualQuantity: 0 });
      expect(produce.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ProduceStatus.SOLD_OUT }),
        }),
      );
    });

    it('flips a SOLD_OUT listing back to PUBLISHED once stock returns', async () => {
      produce.findFirst.mockResolvedValue({
        ...current,
        actualQuantity: 0,
        floatingQuantity: 0,
        status: ProduceStatus.SOLD_OUT,
      });
      await service.update(user, produceId, { actualQuantity: 50 });
      expect(produce.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ProduceStatus.PUBLISHED }),
        }),
      );
    });

    it('maps a concurrent stock change to 409', async () => {
      produce.findFirst.mockResolvedValue(current);
      produce.update.mockRejectedValue(prismaError('P2025'));
      await expect(
        service.update(user, produceId, { actualQuantity: 90 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('maps a delete blocked by orders to 409', async () => {
    produce.delete.mockRejectedValue(prismaError('P2003'));
    await expect(service.remove(user, produceId)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  describe('attachImage', () => {
    it('404s on produce the user does not own', async () => {
      produce.findFirst.mockResolvedValue(null);
      await expect(
        service.attachImage(user, produceId, imageFile),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.uploadPublic).not.toHaveBeenCalled();
    });

    it('uploads to the public bucket and persists the returned URL', async () => {
      produce.findFirst.mockResolvedValue({ id: produceId });
      storage.uploadPublic.mockResolvedValue(imageUrl);
      produce.update.mockResolvedValue({ id: produceId, imageUrl });

      await service.attachImage(user, produceId, imageFile);

      expect(storage.uploadPublic).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^produce/${produceId}/.+\\.png$`)),
        imageFile.buffer,
        'image/png',
      );
      expect(produce.update).toHaveBeenCalledWith({
        where: { id: produceId, farm: ownedByUser },
        data: { imageUrl },
      });
    });

    it('maps a concurrent delete between the ownership check and the write to 404', async () => {
      produce.findFirst.mockResolvedValue({ id: produceId });
      storage.uploadPublic.mockResolvedValue(imageUrl);
      produce.update.mockRejectedValue(prismaError('P2025'));

      await expect(
        service.attachImage(user, produceId, imageFile),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
