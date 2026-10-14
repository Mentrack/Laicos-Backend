import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma, User } from '../../generated/client';
import { requireBuyer } from '../buyer/utils/require-buyer';
import { LocationService } from '../location/location.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAddressDto, UpdateAddressDto } from './dto';
import { ADDRESS_INCLUDE, formatAddress } from './formatters/address.formatter';
import { lockAddresses } from './utils/address-lock';
import { addressNotFound } from './utils/address-not-found';

// Bounds GET /addresses, which is unpaginated.
const MAX_ADDRESSES = 20;

@Injectable()
export class AddressService {
  constructor(
    private readonly database: PrismaService,
    private readonly locations: LocationService,
  ) {}

  async findAll(user: User) {
    const buyer = await requireBuyer(this.database, user);
    const addresses = await this.database.address.findMany({
      where: { buyerId: buyer.id },
      include: ADDRESS_INCLUDE,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return addresses.map(formatAddress);
  }

  async create(user: User, dto: CreateAddressDto) {
    const buyer = await requireBuyer(this.database, user);
    return this.database.$transaction(async (tx) => {
      await lockAddresses(tx, buyer.id);
      const count = await tx.address.count({ where: { buyerId: buyer.id } });
      if (count >= MAX_ADDRESSES) {
        throw new ConflictException({
          message: `You can save at most ${MAX_ADDRESSES} addresses`,
          code: 'ADDRESS_LIMIT',
        });
      }
      await this.locations.requireLga(dto.stateId, dto.lgaId, tx);
      const address = await tx.address.create({
        data: { ...dto, buyerId: buyer.id, isDefault: count === 0 },
        include: ADDRESS_INCLUDE,
      });
      return formatAddress(address);
    });
  }

  async update(user: User, id: string, dto: UpdateAddressDto) {
    const buyer = await requireBuyer(this.database, user);
    return this.database.$transaction(async (tx) => {
      await lockAddresses(tx, buyer.id);
      const existing = await findOwn(tx, buyer.id, id);
      const { isDefault, ...fields } = dto;
      if (fields.stateId || fields.lgaId) {
        await this.locations.requireLga(
          fields.stateId ?? existing.stateId,
          fields.lgaId ?? existing.lgaId,
          tx,
        );
      }
      // Cleared first: the partial unique index allows one default at a time.
      if (isDefault) {
        await tx.address.updateMany({
          where: { buyerId: buyer.id, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      const address = await tx.address.update({
        where: { id },
        data: { ...fields, ...(isDefault ? { isDefault } : {}) },
        include: ADDRESS_INCLUDE,
      });
      return formatAddress(address);
    });
  }

  async remove(user: User, id: string) {
    const buyer = await requireBuyer(this.database, user);
    return this.database.$transaction(async (tx) => {
      await lockAddresses(tx, buyer.id);
      const existing = await findOwn(tx, buyer.id, id);
      const removed = await tx.address.delete({
        where: { id },
        include: ADDRESS_INCLUDE,
      });
      if (existing.isDefault) {
        const newest = await tx.address.findFirst({
          where: { buyerId: buyer.id },
          orderBy: { createdAt: 'desc' },
        });
        if (newest) {
          await tx.address.update({
            where: { id: newest.id },
            data: { isDefault: true },
          });
        }
      }
      return formatAddress(removed);
    });
  }
}

async function findOwn(
  tx: Prisma.TransactionClient,
  buyerId: string,
  id: string,
) {
  const address = await tx.address.findFirst({
    where: { id, buyerId },
  });
  if (!address) {
    throw addressNotFound();
  }
  return address;
}
