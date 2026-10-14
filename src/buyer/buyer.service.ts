import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, User } from '../../generated/client';
import { LocationService } from '../location/location.service';
import { PrismaService } from '../prisma/prisma.service';
import type { BuyerDto, BuyerProfileDto, UpdateBuyerDto } from './dto';
import { toBuyerDto, toBuyerProfileDto } from './formatters/buyer.formatter';
import { requireBuyer } from './utils/require-buyer';

const WITH_LOCATION = { state: true, lga: true } as const;

@Injectable()
export class BuyerService {
  constructor(
    private readonly database: PrismaService,
    private readonly locations: LocationService,
  ) {}

  async findMine(user: User): Promise<BuyerProfileDto> {
    const buyer = await this.database.buyer.findUnique({
      where: { userId: user.id },
      include: WITH_LOCATION,
    });
    if (!buyer) {
      throw new NotFoundException('Buyer profile not found');
    }
    return toBuyerProfileDto(buyer);
  }

  async updateMine(user: User, dto: UpdateBuyerDto) {
    const buyer = await requireBuyer(this.database, user);
    let location: Prisma.BuyerUpdateInput = {};
    if (dto.stateId !== undefined || dto.lgaId !== undefined) {
      const stateId = dto.stateId ?? buyer.stateId;
      const lgaId = dto.lgaId ?? buyer.lgaId;
      if (!stateId || !lgaId) {
        throw new BadRequestException('Invalid state or LGA');
      }
      await this.locations.requireLga(stateId, lgaId);
      location = {
        state: { connect: { id: stateId } },
        lga: { connect: { id: lgaId } },
      };
    }
    await this.database.buyer.update({
      where: { id: buyer.id },
      data: location,
    });
    return this.findMine(user);
  }

  async findOne(id: string): Promise<BuyerDto> {
    const buyer = await this.database.buyer.findUnique({ where: { id } });
    if (!buyer) {
      throw new NotFoundException('Buyer profile not found');
    }
    return toBuyerDto(buyer);
  }
}
