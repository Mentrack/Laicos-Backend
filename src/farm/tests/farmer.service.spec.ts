import { NotFoundException } from '@nestjs/common';
import { Role, type User } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FarmerService } from '../services/farmer.service';

const user = { id: 'user-1', role: Role.FARMER } as User;

describe('FarmerService', () => {
  const farmer = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  };
  const database = {
    farmer,
    $transaction: jest.fn((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    ),
  };
  const service = new FarmerService(database as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('finds the current user’s farmer by userId', async () => {
    const row = { id: 'farmer-1', farmerId: 'FRM-000001' };
    farmer.findUnique.mockResolvedValue(row);
    await expect(service.findMine(user)).resolves.toBe(row);
    expect(farmer.findUnique).toHaveBeenCalledWith({
      where: { userId: user.id },
    });
  });

  it('404s when the farmer does not exist', async () => {
    farmer.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns a page with metaData', async () => {
    farmer.findMany.mockResolvedValue([]);
    farmer.count.mockResolvedValue(0);
    const result = await service.findAll({ page: 1, perPage: 20 });
    expect(result).toEqual({
      data: [],
      metaData: { page: 1, perPage: 20, total: 0, totalPages: 0 },
    });
  });
});
