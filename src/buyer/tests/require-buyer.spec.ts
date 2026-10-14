import { NotFoundException } from '@nestjs/common';
import { Role, type User } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { requireBuyer } from '../utils/require-buyer';

const user = { id: 'user-1', role: Role.BUYER } as User;
const row = {
  id: 'buyer-1',
  buyerId: 'BY-000001',
  userId: user.id,
};

describe('requireBuyer', () => {
  const buyer = { findUnique: jest.fn() };
  const database = { buyer } as unknown as PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the buyer for the user', async () => {
    buyer.findUnique.mockResolvedValue(row);

    await expect(requireBuyer(database, user)).resolves.toEqual(row);
    expect(buyer.findUnique).toHaveBeenCalledWith({
      where: { userId: user.id },
    });
  });

  it('404s when the user has no buyer profile', async () => {
    buyer.findUnique.mockResolvedValue(null);

    await expect(requireBuyer(database, user)).rejects.toThrow(
      NotFoundException,
    );
    await expect(requireBuyer(database, user)).rejects.toThrow(
      'Buyer profile not found',
    );
  });
});
