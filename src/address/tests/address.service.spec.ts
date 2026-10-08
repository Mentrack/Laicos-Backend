import { BadRequestException, HttpException } from '@nestjs/common';
import { Role, type User } from '../../../generated/client';
import { LocationService } from '../../location/location.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AddressService } from '../address.service';

const buyer = { id: 'buyer-1', role: Role.BUYER } as User;
const id = '9d2e7c4a-1b3f-4e5d-8a6b-7c8d9e0f1a2b';
const input = {
  label: 'Warehouse A',
  street: '12, Bompai Industrial Area',
  stateId: 'state-1',
  lgaId: 'lga-1',
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id,
    buyerId: buyer.id,
    ...input,
    contactName: null,
    contactPhone: null,
    isDefault: false,
    createdAt: new Date('2026-10-08T00:00:00Z'),
    updatedAt: new Date('2026-10-08T00:00:00Z'),
    state: { id: 'state-1', name: 'Kano' },
    lga: { id: 'lga-1', name: 'Nassarawa' },
    ...overrides,
  };
}

async function errorBody(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse();
}

describe('AddressService', () => {
  const tx = {
    $executeRaw: jest.fn(),
    address: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const database = {
    ...tx,
    $transaction: (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  const locations = { requireLga: jest.fn() };
  const service = new AddressService(
    database as unknown as PrismaService,
    locations as unknown as LocationService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    tx.address.create.mockResolvedValue(row());
    tx.address.update.mockResolvedValue(row());
    tx.address.delete.mockResolvedValue(row());
  });

  it('lists the default first, then newest', async () => {
    tx.address.findMany.mockResolvedValue([row()]);
    await service.findAll(buyer);
    expect(tx.address.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buyerId: buyer.id },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      }),
    );
  });

  it('makes the first address the default, under the buyer lock', async () => {
    tx.address.count.mockResolvedValue(0);
    await service.create(buyer, input);
    expect(tx.$executeRaw).toHaveBeenCalledWith(
      expect.anything(),
      `addresses:${buyer.id}`,
    );
    expect(locations.requireLga).toHaveBeenCalledWith('state-1', 'lga-1', tx);
    expect(tx.address.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { ...input, buyerId: buyer.id, isDefault: true },
      }),
    );
  });

  it('does not make later addresses the default', async () => {
    tx.address.count.mockResolvedValue(3);
    await service.create(buyer, input);
    expect(tx.address.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isDefault: false }) as unknown,
      }),
    );
  });

  it('caps a buyer at 20 addresses', async () => {
    tx.address.count.mockResolvedValue(20);
    await expect(errorBody(service.create(buyer, input))).resolves.toEqual({
      message: 'You can save at most 20 addresses',
      code: 'ADDRESS_LIMIT',
    });
    expect(tx.address.create).not.toHaveBeenCalled();
  });

  it('refuses an LGA outside the state', async () => {
    tx.address.count.mockResolvedValue(0);
    locations.requireLga.mockRejectedValue(
      new BadRequestException('Invalid state or LGA'),
    );
    await expect(service.create(buyer, input)).rejects.toThrow(
      'Invalid state or LGA',
    );
  });

  it("404s another buyer's address", async () => {
    tx.address.findFirst.mockResolvedValue(null);
    await expect(
      errorBody(service.update(buyer, id, { label: 'x' })),
    ).resolves.toMatchObject({ code: 'ADDRESS_NOT_FOUND' });
    await expect(errorBody(service.remove(buyer, id))).resolves.toMatchObject({
      code: 'ADDRESS_NOT_FOUND',
    });
  });

  it('checks the resulting state and LGA pair on update', async () => {
    tx.address.findFirst.mockResolvedValue(row());
    await service.update(buyer, id, { lgaId: 'lga-2' });
    expect(locations.requireLga).toHaveBeenCalledWith('state-1', 'lga-2', tx);
  });

  it('skips the LGA check when neither changes', async () => {
    tx.address.findFirst.mockResolvedValue(row());
    await service.update(buyer, id, { label: 'Home' });
    expect(locations.requireLga).not.toHaveBeenCalled();
  });

  it('clears the old default before setting the new one', async () => {
    tx.address.findFirst.mockResolvedValue(row());
    await service.update(buyer, id, { isDefault: true });
    expect(tx.address.updateMany).toHaveBeenCalledWith({
      where: { buyerId: buyer.id, isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
    expect(tx.address.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isDefault: true } }),
    );
    expect(tx.address.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.address.update.mock.invocationCallOrder[0],
    );
  });

  it('promotes the newest remaining address when the default is deleted', async () => {
    tx.address.findFirst
      .mockResolvedValueOnce(row({ isDefault: true }))
      .mockResolvedValueOnce(row({ id: 'newest' }));
    await service.remove(buyer, id);
    expect(tx.address.findFirst).toHaveBeenLastCalledWith({
      where: { buyerId: buyer.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(tx.address.update).toHaveBeenCalledWith({
      where: { id: 'newest' },
      data: { isDefault: true },
    });
  });

  it('promotes nothing when a non-default address is deleted', async () => {
    tx.address.findFirst.mockResolvedValue(row({ isDefault: false }));
    await service.remove(buyer, id);
    expect(tx.address.update).not.toHaveBeenCalled();
  });
});
