import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditActorType,
  AuditCategory,
  AuditResource,
  FarmVerificationStatus,
  Prisma,
  ProduceCategory,
  ProduceStatus,
  ProduceType,
  Role,
  type User,
} from '../../../generated/client';
import { AuditService } from '../../audit/audit.service';
import type { StorageUploadFile } from '../../common/upload-pipes';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { ProduceSort } from '../dto';
import { ProduceService } from '../produce.service';

const user = { id: 'user-1', role: Role.FARMER } as User;
const buyer = { id: 'buyer-1', role: Role.BUYER } as User;
const farmId = '6f1c1c3e-2b8e-4a55-9d0e-3b6b1f0c9a11';
const produceId = '0b7f5a52-6f3c-4f1e-9a57-2f7d8b3c1e22';
const farmCode = 'LF-000001';
const ownedFarm = { id: farmId, farmCode, ownerId: 'farmer-1' };
const ownedByUser = { owner: { userId: user.id } };
// Other farmers' produce shows only while it is on sale, on a verified farm.
const visible = {
  OR: [
    {
      status: { in: [ProduceStatus.PUBLISHED, ProduceStatus.SOLD_OUT] },
      farm: { verificationStatus: FarmVerificationStatus.VERIFIED },
    },
    { farm: ownedByUser },
  ],
};
// Buyers get the farm's code and region, never its street address.
const listingInclude = {
  farm: {
    select: {
      id: true,
      farmCode: true,
      verificationStatus: true,
      country: true,
      state: { select: { id: true, name: true } },
      lga: { select: { id: true, stateId: true, name: true } },
    },
  },
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
    findMany: jest.fn<Promise<unknown[]>, [Prisma.ProduceFindManyArgs]>(),
    count: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const sourcingAllocation = { count: jest.fn() };
  const tx = { produce, sourcingAllocation };
  const database = {
    farm,
    produce,
    // Array form for batched reads; callback form runs against the same mocks.
    $transaction: (
      arg: Promise<unknown>[] | ((client: typeof tx) => Promise<unknown>),
    ) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg)),
  };
  const storage = { uploadPublic: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new ProduceService(
    database as unknown as PrismaService,
    storage as unknown as StorageService,
    audit as unknown as AuditService,
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

    it('records the listing on create', async () => {
      farm.findFirst.mockResolvedValue(ownedFarm);
      produce.create.mockResolvedValue({ id: produceId, ...dto });
      await service.create(user, dto, imageFile);
      expect(audit.record).toHaveBeenCalledWith(tx, {
        actorType: AuditActorType.FARMER,
        farmerId: 'farmer-1',
        agentId: null,
        farmId,
        category: AuditCategory.LISTING,
        title: 'Listing created',
        summary: `${dto.name} on ${farmCode}`,
        actionLabel: 'View product',
        resource: AuditResource.PRODUCE,
        resourceId: expect.any(String),
      });
    });

    it('starts quantity, actualQuantity and floatingQuantity equal, DRAFT by default', async () => {
      farm.findFirst.mockResolvedValue(ownedFarm);
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
      farm.findFirst.mockResolvedValue(ownedFarm);
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
      farm.findFirst.mockResolvedValue(ownedFarm);
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

  describe('findAll', () => {
    beforeEach(() => {
      produce.findMany.mockResolvedValue([]);
      produce.count.mockResolvedValue(3);
    });

    function findManyArgs() {
      return produce.findMany.mock.calls[0][0];
    }

    it('filters by status and type and hides other farmers’ drafts', async () => {
      const result = await service.findAll(user, {
        status: ProduceStatus.PUBLISHED,
        type: ProduceType.EXPORT,
      });
      const { where, skip, take } = findManyArgs();
      expect(where).toMatchObject({
        ...visible,
        status: ProduceStatus.PUBLISHED,
        type: ProduceType.EXPORT,
      });
      expect({ skip, take }).toEqual({ skip: 0, take: 20 });
      expect(produce.count).toHaveBeenCalledWith({ where });
      expect(result.metaData.total).toBe(3);
    });

    it('shows buyers only orderable listings by default', async () => {
      await service.findAll(buyer, {});
      expect(findManyArgs().where?.status).toBe(ProduceStatus.PUBLISHED);
    });

    it('lets buyers ask for sold-out listings', async () => {
      await service.findAll(buyer, { status: ProduceStatus.SOLD_OUT });
      expect(findManyArgs().where?.status).toBe(ProduceStatus.SOLD_OUT);
    });

    it('leaves a farmer’s list unfiltered by status by default', async () => {
      await service.findAll(user, {});
      expect(findManyArgs().where?.status).toBeUndefined();
    });

    it('searches the name case-insensitively', async () => {
      await service.findAll(buyer, { search: 'cassava' });
      expect(findManyArgs().where?.name).toEqual({
        contains: 'cassava',
        mode: 'insensitive',
      });
    });

    it('filters by category', async () => {
      await service.findAll(buyer, { category: ProduceCategory.TUBERS });
      expect(findManyArgs().where?.category).toBe(ProduceCategory.TUBERS);
    });

    it('filters by the farm’s state and LGA', async () => {
      await service.findAll(buyer, { stateId: 'state-1', lgaId: 'lga-1' });
      expect(findManyArgs().where?.farm).toEqual({
        stateId: 'state-1',
        lgaId: 'lga-1',
      });
    });

    it('filters by a price range', async () => {
      await service.findAll(buyer, { minPrice: 100, maxPrice: 500 });
      expect(findManyArgs().where?.pricePerUnit).toEqual({
        gte: 100,
        lte: 500,
      });
    });

    it('rejects a price range whose minimum exceeds its maximum', async () => {
      await expect(
        service.findAll(buyer, { minPrice: 500, maxPrice: 100 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(produce.findMany).not.toHaveBeenCalled();
    });

    it('includes the farm’s code and region', async () => {
      await service.findAll(buyer, {});
      expect(findManyArgs().include).toEqual(listingInclude);
    });

    it.each([
      [undefined, { createdAt: 'desc' }],
      [ProduceSort.NEWEST, { createdAt: 'desc' }],
      [ProduceSort.PRICE_ASC, { pricePerUnit: 'asc' }],
      [ProduceSort.PRICE_DESC, { pricePerUnit: 'desc' }],
      [ProduceSort.STOCK_DESC, { floatingQuantity: 'desc' }],
    ])('sorts %s by %o, then id for stable paging', async (sort, primary) => {
      await service.findAll(buyer, { sort });
      expect(findManyArgs().orderBy).toEqual([primary, { id: 'desc' }]);
    });

    it('shows a guest only published listings on verified farms', async () => {
      await service.findAll(null, {});
      expect(findManyArgs().where).toMatchObject({
        OR: [
          {
            status: { in: [ProduceStatus.PUBLISHED, ProduceStatus.SOLD_OUT] },
            farm: { verificationStatus: FarmVerificationStatus.VERIFIED },
          },
        ],
        status: ProduceStatus.PUBLISHED,
      });
    });
  });

  it('looks a guest up only among listings anyone can see', async () => {
    produce.findFirst.mockResolvedValue({ id: produceId });
    await service.findOne(null, produceId);
    expect(produce.findFirst).toHaveBeenCalledWith({
      where: {
        id: produceId,
        OR: [
          {
            status: { in: [ProduceStatus.PUBLISHED, ProduceStatus.SOLD_OUT] },
            farm: { verificationStatus: FarmVerificationStatus.VERIFIED },
          },
        ],
      },
      include: listingInclude,
    });
  });

  it('404s on produce the user cannot see', async () => {
    produce.findFirst.mockResolvedValue(null);
    await expect(service.findOne(user, produceId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(produce.findFirst).toHaveBeenCalledWith({
      where: { id: produceId, ...visible },
      include: listingInclude,
    });
  });

  describe('update', () => {
    // 100 on hand, 30 reserved by orders.
    const current = {
      id: produceId,
      farmId,
      name: 'Maize',
      actualQuantity: 100,
      floatingQuantity: 70,
      unit: 'kg',
      status: ProduceStatus.PUBLISHED,
      farm: { farmCode, ownerId: 'farmer-1' },
    };

    it('404s on produce the user does not own', async () => {
      produce.findFirst.mockResolvedValue(null);
      await expect(
        service.update(user, produceId, { name: 'New' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(produce.findFirst).toHaveBeenCalledWith({
        where: { id: produceId, farm: ownedByUser },
        include: { farm: { select: { farmCode: true, ownerId: true } } },
      });
      expect(produce.update).not.toHaveBeenCalled();
    });

    it('records the listing on update', async () => {
      produce.findFirst.mockResolvedValue(current);
      produce.update.mockResolvedValue({ ...current, name: 'New' });
      await service.update(user, produceId, { name: 'New' });
      expect(audit.record).toHaveBeenCalledWith(tx, {
        actorType: AuditActorType.FARMER,
        farmerId: 'farmer-1',
        agentId: null,
        farmId,
        category: AuditCategory.LISTING,
        title: 'Listing updated',
        summary: 'New on LF-000001',
        actionLabel: 'View product',
        resource: AuditResource.PRODUCE,
        resourceId: produceId,
      });
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

    it('refuses to drop below what orders reserved', async () => {
      produce.findFirst.mockResolvedValue(current);
      await expect(
        service.update(user, produceId, { actualQuantity: 20 }),
      ).rejects.toThrow('30 kg is reserved by orders');
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

    it('keeps an admin-disabled listing disabled when the farmer edits it', async () => {
      produce.findFirst.mockResolvedValue({
        ...current,
        status: ProduceStatus.DISABLED,
      });
      await service.update(user, produceId, {
        status: ProduceStatus.PUBLISHED,
      });
      expect(produce.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ProduceStatus.DISABLED }),
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

  describe('remove', () => {
    it('records the listing without a deep link', async () => {
      produce.findFirst.mockResolvedValue({
        id: produceId,
        name: 'Maize',
        farmId,
        farm: { farmCode, ownerId: 'farmer-1' },
      });
      produce.delete.mockResolvedValue({ id: produceId });
      await service.remove(user, produceId);
      expect(audit.record).toHaveBeenCalledWith(tx, {
        actorType: AuditActorType.FARMER,
        farmerId: 'farmer-1',
        agentId: null,
        farmId,
        category: AuditCategory.LISTING,
        title: 'Listing removed',
        summary: 'Maize on LF-000001',
        actionLabel: null,
        resource: null,
        resourceId: null,
      });
    });

    it('maps a delete blocked by orders to 409', async () => {
      produce.findFirst.mockResolvedValue({
        id: produceId,
        name: 'Maize',
        farmId,
        farm: { farmCode, ownerId: 'farmer-1' },
      });
      produce.delete.mockRejectedValue(prismaError('P2003'));
      await expect(service.remove(user, produceId)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses to delete a listing still in a sourcing selection', async () => {
      produce.findFirst.mockResolvedValue({
        id: produceId,
        name: 'Maize',
        farmId,
        farm: { farmCode, ownerId: 'farmer-1' },
      });
      sourcingAllocation.count.mockResolvedValue(1);
      await expect(service.remove(user, produceId)).rejects.toThrow(
        'Produce is part of a sourcing selection and cannot be deleted',
      );
      expect(produce.delete).not.toHaveBeenCalled();
    });
  });

  describe('attachImage', () => {
    it('404s on produce the user does not own', async () => {
      produce.findFirst.mockResolvedValue(null);
      await expect(
        service.attachImage(user, produceId, imageFile),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.uploadPublic).not.toHaveBeenCalled();
    });

    it('does not write an audit row', async () => {
      produce.findFirst.mockResolvedValue({ id: produceId });
      storage.uploadPublic.mockResolvedValue(imageUrl);
      produce.update.mockResolvedValue({ id: produceId, imageUrl });
      await service.attachImage(user, produceId, imageFile);
      expect(audit.record).not.toHaveBeenCalled();
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
