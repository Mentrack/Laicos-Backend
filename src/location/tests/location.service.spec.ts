import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LocationService } from '../location.service';

describe('LocationService', () => {
  const state = { findMany: jest.fn(), findUnique: jest.fn() };
  const lga = { findFirst: jest.fn() };
  const database = { state, lga };
  const service = new LocationService(database as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('lists a state’s LGAs', async () => {
    const lgas = [{ id: 'lga-1', name: 'Ogbomosho North' }];
    state.findUnique.mockResolvedValue({ id: 'state-1', lgas });
    await expect(service.findLgas('state-1')).resolves.toBe(lgas);
  });

  it('404s an unknown state', async () => {
    state.findUnique.mockResolvedValue(null);
    await expect(service.findLgas('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('accepts an LGA only within its state', async () => {
    lga.findFirst.mockResolvedValue({ id: 'lga-1', name: 'Ogbomosho North' });
    await service.requireLga('state-1', 'lga-1');
    expect(lga.findFirst).toHaveBeenCalledWith({
      where: { id: 'lga-1', stateId: 'state-1' },
    });
  });

  it('rejects an LGA outside the given state', async () => {
    lga.findFirst.mockResolvedValue(null);
    await expect(
      service.requireLga('state-1', 'lga-elsewhere'),
    ).rejects.toThrow(new BadRequestException('Invalid state or LGA'));
  });
});
