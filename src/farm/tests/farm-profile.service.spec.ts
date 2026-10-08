import { NotFoundException } from '@nestjs/common';
import {
  FarmVerificationStatus,
  ProduceStatus,
  Role,
  type User,
} from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FarmProfileService } from '../services/farm-profile.service';

const buyer = { id: 'buyer-1', role: Role.BUYER } as User;
const farmId = '6f1c1c3e-2b8e-4a55-9d0e-3b6b1f0c9a11';
const row = {
  id: farmId,
  farmCode: 'LF-000123',
  verificationStatus: FarmVerificationStatus.VERIFIED,
  country: 'NG',
  mainProduce: 'Cassava',
  state: { id: 'state-1', name: 'Oyo' },
  lga: { id: 'lga-1', stateId: 'state-1', name: 'Ogbomosho North' },
  produce: [
    { name: 'Groundnut' },
    { name: 'cassava' },
    { name: 'Sesame Seeds' },
    { name: ' Groundnut ' },
    { name: 'Yam' },
  ],
};

describe('FarmProfileService', () => {
  const farm = { findFirst: jest.fn() };
  const service = new FarmProfileService({
    farm,
  } as unknown as PrismaService);

  beforeEach(() => jest.resetAllMocks());

  it('shows verified farms, and unverified ones only to their owner', async () => {
    farm.findFirst.mockResolvedValue(row);
    await service.findOne(buyer, farmId);
    expect(farm.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: farmId,
          OR: [
            { verificationStatus: FarmVerificationStatus.VERIFIED },
            { owner: { userId: buyer.id } },
          ],
        },
      }),
    );
  });

  it('lists only non-draft listings for the primary produce', async () => {
    farm.findFirst.mockResolvedValue(row);
    await service.findOne(buyer, farmId);
    expect(farm.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          produce: {
            where: { status: { not: ProduceStatus.DRAFT } },
            select: { name: true },
            orderBy: { createdAt: 'asc' },
          },
        }) as unknown,
      }),
    );
  });

  it('puts the declared main produce first and dedupes case-insensitively', async () => {
    farm.findFirst.mockResolvedValue(row);
    const profile = await service.findOne(buyer, farmId);
    expect(profile.primaryProduce).toEqual([
      'Cassava',
      'Groundnut',
      'Sesame Seeds',
      'Yam',
    ]);
  });

  it('never exposes the street address or owner', async () => {
    farm.findFirst.mockResolvedValue(row);
    const profile = await service.findOne(buyer, farmId);
    expect(profile).toEqual({
      id: farmId,
      farmCode: 'LF-000123',
      verificationStatus: FarmVerificationStatus.VERIFIED,
      country: 'NG',
      state: row.state,
      lga: row.lga,
      primaryProduce: expect.any(Array) as unknown,
    });
  });

  it('404s on a farm the caller cannot see', async () => {
    farm.findFirst.mockResolvedValue(null);
    await expect(service.findOne(buyer, farmId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
