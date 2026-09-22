import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, Role, type User } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FarmService } from '../services/farm.service';

const user = { id: 'user-1', role: Role.FARMER } as User;
const farmId = '6f1c1c3e-2b8e-4a55-9d0e-3b6b1f0c9a11';

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
  });
}

describe('FarmService', () => {
  const farm = {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const database = {
    farm,
    $transaction: jest.fn((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    ),
  };
  const service = new FarmService(database as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('creates a farm connected to the user’s farmer', async () => {
    farm.create.mockResolvedValue({ id: farmId });
    await service.create(user, {
      name: 'A',
      location: 'B',
      size: 2,
      mainProduce: 'Maize',
    });
    expect(farm.create).toHaveBeenCalledWith({
      data: {
        name: 'A',
        location: 'B',
        size: 2,
        unit: undefined,
        mainProduce: 'Maize',
        isExporting: undefined,
        referralAgentId: undefined,
        owner: { connect: { userId: user.id } },
      },
    });
  });

  it('maps a missing farmer on create to 404', async () => {
    farm.create.mockRejectedValue(prismaError('P2025'));
    await expect(
      service.create(user, {
        name: 'A',
        location: 'B',
        size: 2,
        mainProduce: 'Maize',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('paginates only the user’s farms', async () => {
    farm.findMany.mockResolvedValue([]);
    farm.count.mockResolvedValue(45);
    const result = await service.findAll(user, { page: 2, perPage: 20 });
    const where = { owner: { userId: user.id } };
    expect(farm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 20, take: 20 }),
    );
    expect(farm.count).toHaveBeenCalledWith({ where });
    expect(result.metaData).toEqual({
      page: 2,
      perPage: 20,
      total: 45,
      totalPages: 3,
    });
  });

  it('404s on a farm the user does not own', async () => {
    farm.findFirst.mockResolvedValue(null);
    await expect(service.findOne(user, farmId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(farm.findFirst).toHaveBeenCalledWith({
      where: { id: farmId, owner: { userId: user.id } },
    });
  });

  it('scopes updates to the owner and maps no match to 404', async () => {
    farm.update.mockRejectedValue(prismaError('P2025'));
    await expect(
      service.update(user, farmId, { name: 'New' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(farm.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: farmId, owner: { userId: user.id } },
      }),
    );
  });

  it('maps a delete blocked by orders to 409', async () => {
    farm.delete.mockRejectedValue(prismaError('P2003'));
    await expect(service.remove(user, farmId)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rethrows unknown errors untouched', async () => {
    const error = new Error('db down');
    farm.delete.mockRejectedValue(error);
    await expect(service.remove(user, farmId)).rejects.toBe(error);
  });
});
