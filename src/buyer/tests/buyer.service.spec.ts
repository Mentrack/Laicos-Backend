import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role, type User } from '../../../generated/client';
import { LocationService } from '../../location/location.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BuyerService } from '../buyer.service';

const user = { id: 'user-1', role: Role.BUYER } as User;
const created = new Date('2026-10-01');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'buyer-1',
    buyerId: 'BY-000001',
    userId: user.id,
    stateId: null,
    state: null,
    lgaId: null,
    lga: null,
    createdAt: created,
    updatedAt: created,
    ...overrides,
  };
}

describe('BuyerService', () => {
  const buyer = { findUnique: jest.fn(), update: jest.fn() };
  const database = { buyer };
  const locations = { requireLga: jest.fn() };
  const service = new BuyerService(
    database as unknown as PrismaService,
    locations as unknown as LocationService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    buyer.findUnique.mockResolvedValue(row());
    locations.requireLga.mockResolvedValue({
      id: 'lga-1',
      stateId: 'state-1',
      name: 'Nassarawa',
    });
  });

  it('returns my profile with no location yet', async () => {
    await expect(service.findMine(user)).resolves.toEqual({
      id: 'buyer-1',
      buyerId: 'BY-000001',
      userId: user.id,
      state: null,
      lga: null,
      createdAt: created,
      updatedAt: created,
    });
  });

  it('404s a user without a buyer profile', async () => {
    buyer.findUnique.mockResolvedValue(null);
    await expect(service.findMine(user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses a location with only one of stateId or lgaId', async () => {
    await expect(
      service.updateMine(user, { stateId: 'state-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(buyer.update).not.toHaveBeenCalled();
  });

  it('saves state and LGA together', async () => {
    await service.updateMine(user, { stateId: 'state-1', lgaId: 'lga-1' });
    expect(locations.requireLga).toHaveBeenCalledWith('state-1', 'lga-1');
    expect(buyer.update).toHaveBeenCalledWith({
      where: { id: 'buyer-1' },
      data: {
        state: { connect: { id: 'state-1' } },
        lga: { connect: { id: 'lga-1' } },
      },
    });
  });

  it('returns only the public fields for another user', async () => {
    await expect(service.findOne('buyer-1')).resolves.toEqual({
      id: 'buyer-1',
      buyerId: 'BY-000001',
    });
  });
});
